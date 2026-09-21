import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
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
import {
  FakeDiscordSeriesChannelGateway,
  withM2DSeriesFixtures,
} from "./helpers/discord-series-channel-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = withM2DSeriesFixtures(
  buildApp(
    { logger: false },
    {
      database: database.db,
      secureCookie: false,
      seriesChannelGateway: new FakeDiscordSeriesChannelGateway(),
    },
  ),
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
      headers: {
        cookie: ownerCookie,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36",
      },
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

    await database.db.insert(auditLogs).values({
      actorId: ownerId,
      action: "chapter.upload.completed",
      resourceType: "chapter",
      resourceId: createdChapterId,
      metadata: {
        imageCount: 11,
        nested: { safe: "visible", secretToken: "must-not-leak" },
      },
    });

    const auditResponse = await app.inject({
      method: "GET",
      url: "/admin/audit",
      headers: { cookie: adminCookie },
    });
    expect(auditResponse.statusCode).toBe(200);
    const auditPage = auditResponse.json();
    expect(auditPage).toMatchObject({
      total: expect.any(Number),
      items: expect.arrayContaining([
        expect.objectContaining({
          requestId,
          result: "rejected",
          reasonCode: "chapter-conflict",
        }),
      ]),
    });
    expect(auditPage.items).toContainEqual(
      expect.objectContaining({
        requestId: createdRequestId,
        resource: expect.objectContaining({
          type: "chapter",
          id: createdChapterId,
          chapter: expect.objectContaining({ number: 10 }),
          series: expect.objectContaining({
            id: seriesId,
            title: "OBS audit series",
          }),
        }),
        request: expect.objectContaining({
          method: "POST",
          browser: "Chrome 128.0.0.0",
          operatingSystem: "Windows 10/11",
        }),
      }),
    );

    const filteredPage = await app.inject({
      method: "GET",
      url: `/admin/audit?limit=1&result=rejected&search=chapter&actorId=${ownerId}`,
      headers: { cookie: adminCookie },
    });
    expect(filteredPage.statusCode).toBe(200);
    expect(filteredPage.json()).toMatchObject({
      total: 1,
      items: [
        expect.objectContaining({
          action: "chapter.created",
          result: "rejected",
        }),
      ],
      nextCursor: null,
    });

    const safeMetadataPage = await app.inject({
      method: "GET",
      url: "/admin/audit?limit=10&search=upload",
      headers: { cookie: adminCookie },
    });
    expect(safeMetadataPage.statusCode).toBe(200);
    expect(safeMetadataPage.json().items).toContainEqual(
      expect.objectContaining({
        metadata: { imageCount: 11, nested: { safe: "visible" } },
      }),
    );

    const exportResponse = await app.inject({
      method: "GET",
      url: "/admin/audit/export?result=rejected",
      headers: { cookie: adminCookie },
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers["content-type"]).toContain("text/csv");
    expect(exportResponse.body).toContain("chapter.created");

    const denied = await app.inject({
      method: "GET",
      url: "/admin/audit",
      headers: { cookie: ownerCookie },
    });
    expect(denied.statusCode).toBe(403);
  });
});
