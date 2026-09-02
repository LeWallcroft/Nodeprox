import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapters,
  series,
  sessions,
  users,
} from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const password = "obs-audit-test-password";
const ownerId = randomUUID();
const adminId = randomUUID();
const ownerEmail = `obs-owner-${ownerId}@example.com`;
const adminEmail = `obs-admin-${adminId}@example.com`;

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  return cookieValue(response.headers["set-cookie"]);
}

beforeAll(async () => {
  const passwordHash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: ownerId,
      email: ownerEmail,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: adminId,
      email: adminEmail,
      passwordHash,
      status: "active",
      role: "admin",
    },
  ]);
});

afterAll(async () => {
  await database.db
    .delete(sessions)
    .where(inArray(sessions.userId, [ownerId, adminId]));
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, [ownerId, adminId]));
  await database.db.delete(chapters).where(eq(chapters.createdBy, ownerId));
  await database.db.delete(series).where(eq(series.createdBy, ownerId));
  await database.db.delete(users).where(inArray(users.id, [ownerId, adminId]));
  await app.close();
  await database.sql.end();
});

describe("operation audit context", () => {
  it("persists success and rejected chapter operations with the originating request ID", async () => {
    const ownerCookie = await login(ownerEmail);
    const adminCookie = await login(adminEmail);
    const createSeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "OBS audit series", slug: `obs-audit-${ownerId}` },
    });
    expect(createSeries.statusCode).toBe(201);
    const seriesId = createSeries.json().id as string;

    const created = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
      payload: { chapterNumber: 10 },
    });
    expect(created.statusCode).toBe(201);
    const createdRequestId = created.headers["x-request-id"] as string;
    const createdChapterId = created.json().id as string;
    const [successAudit] = await database.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actorId, ownerId),
          eq(auditLogs.resourceId, createdChapterId),
          eq(auditLogs.requestId, createdRequestId),
        ),
      );
    expect(successAudit).toMatchObject({
      action: "chapter.created",
      result: "success",
      requestId: createdRequestId,
    });

    const conflict = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
      payload: { chapterNumber: 10 },
    });
    expect(conflict.statusCode).toBe(409);
    const problem = conflict.json();
    const requestId = conflict.headers["x-request-id"] as string;
    expect(problem).toMatchObject({
      code: "chapter-conflict",
      category: "conflict",
      requestId,
    });

    const [rejectedAudit] = await database.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.actorId, ownerId),
          eq(auditLogs.action, "chapter.created"),
          eq(auditLogs.requestId, requestId),
        ),
      );
    expect(rejectedAudit).toMatchObject({
      result: "rejected",
      reasonCode: "chapter-conflict",
      requestId,
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: "/admin/audit",
      headers: { cookie: adminCookie },
    });
    expect(auditResponse.statusCode).toBe(200);
    expect(auditResponse.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId,
          result: "rejected",
          reasonCode: "chapter-conflict",
        }),
      ]),
    );
  });
});
