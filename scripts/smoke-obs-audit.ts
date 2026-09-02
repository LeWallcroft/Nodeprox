import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { loadDatabaseConfig } from "@nodeprox/config";
import { buildApp } from "../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../database/client.js";
import {
  auditLogs,
  chapters,
  series,
  sessions,
  users,
} from "../database/schema/index.js";

const { DATABASE_URL } = loadDatabaseConfig();
const database = createDatabase(DATABASE_URL);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const password = "obs-local-smoke-password";
const ownerId = randomUUID();
const adminId = randomUUID();
const ownerEmail = `obs-local-owner-${ownerId}@example.com`;
const adminEmail = `obs-local-admin-${adminId}@example.com`;

function assertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  assertion(response.statusCode === 204, "Local smoke login failed");
  return cookieValue(response.headers["set-cookie"]);
}

try {
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

  const ownerCookie = await login(ownerEmail);
  const adminCookie = await login(adminEmail);
  const createdSeries = await app.inject({
    method: "POST",
    url: "/series",
    headers: { cookie: ownerCookie },
    payload: {
      title: "OBS local smoke series",
      slug: `obs-local-smoke-${ownerId}`,
    },
  });
  assertion(createdSeries.statusCode === 201, "Series creation smoke failed");
  const seriesId = createdSeries.json().id as string;

  const createdChapter = await app.inject({
    method: "POST",
    url: `/series/${seriesId}/chapters`,
    headers: { cookie: ownerCookie },
    payload: { chapterNumber: 10 },
  });
  assertion(createdChapter.statusCode === 201, "Chapter creation smoke failed");
  const chapterId = createdChapter.json().id as string;
  const successRequestId = createdChapter.headers["x-request-id"] as string;
  const [successAudit] = await database.db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.actorId, ownerId),
        eq(auditLogs.resourceId, chapterId),
        eq(auditLogs.requestId, successRequestId),
      ),
    );
  assertion(
    successAudit?.result === "success",
    "Success audit was not persisted",
  );

  const conflict = await app.inject({
    method: "POST",
    url: `/series/${seriesId}/chapters`,
    headers: { cookie: ownerCookie },
    payload: { chapterNumber: 10 },
  });
  assertion(
    conflict.statusCode === 409,
    "Chapter conflict did not return HTTP 409",
  );
  const requestId = conflict.headers["x-request-id"] as string;
  const problem = conflict.json();
  assertion(problem.code === "chapter-conflict", "Conflict code is incorrect");
  assertion(
    problem.requestId === requestId,
    "Problem Details requestId mismatch",
  );

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
  assertion(
    rejectedAudit?.result === "rejected",
    "Rejected audit was not persisted",
  );
  assertion(
    rejectedAudit.reasonCode === "chapter-conflict",
    "Rejected audit reason is incorrect",
  );

  const auditResponse = await app.inject({
    method: "GET",
    url: "/admin/audit",
    headers: { cookie: adminCookie },
  });
  assertion(auditResponse.statusCode === 200, "Admin audit lookup failed");
  assertion(
    auditResponse
      .json()
      .some((event: { requestId?: string }) => event.requestId === requestId),
    "Admin audit response did not include the correlated event",
  );

  console.log("OBS audit local smoke: OK");
} finally {
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
}
