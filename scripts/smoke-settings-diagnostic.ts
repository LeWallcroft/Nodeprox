import "dotenv/config";
import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { loadDatabaseConfig } from "@nodeprox/config";
import { buildApp } from "../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../database/client.js";
import {
  auditLogs,
  sessions,
  systemConfig,
  users,
} from "../database/schema/index.js";

const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const password = "settings-diagnostic-password";
const ownerId = randomUUID();
const adminId = randomUUID();
const ownerEmail = `settings-owner-${ownerId}@example.com`;
const adminEmail = `settings-admin-${adminId}@example.com`;

function assertion(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  assertion(response.statusCode === 204, "Diagnostic login failed");
  const value = response.headers["set-cookie"];
  const cookie = Array.isArray(value) ? value[0] : value;
  assertion(cookie, "Expected session cookie");
  return cookie;
}

let original: { value: unknown; updatedBy: string | null } | undefined;
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
  const cookie = await login(adminEmail);
  original = (
    await database.db
      .select({ value: systemConfig.value, updatedBy: systemConfig.updatedBy })
      .from(systemConfig)
      .where(eq(systemConfig.key, "bulk_upload_concurrency"))
      .limit(1)
  )[0];
  const before = await app.inject({
    method: "GET",
    url: "/admin/settings",
    headers: { cookie },
  });
  const patch = await app.inject({
    method: "PATCH",
    url: "/admin/settings",
    headers: { cookie },
    payload: { changes: [{ key: "bulk_upload_concurrency", value: 4 }] },
  });
  const requestId = String(patch.headers["x-request-id"]);
  const stored = (
    await database.db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, "bulk_upload_concurrency"))
      .limit(1)
  )[0];
  const after = await app.inject({
    method: "GET",
    url: "/admin/settings",
    headers: { cookie },
  });
  const audit = await database.db
    .select({
      action: auditLogs.action,
      result: auditLogs.result,
      requestId: auditLogs.requestId,
    })
    .from(auditLogs)
    .where(
      and(eq(auditLogs.actorId, adminId), eq(auditLogs.requestId, requestId)),
    );
  console.log(
    JSON.stringify({
      beforeStatus: before.statusCode,
      patchStatus: patch.statusCode,
      problem: patch.statusCode >= 400 ? patch.json() : null,
      requestId,
      storedValue: stored?.value,
      afterStatus: after.statusCode,
      audit,
    }),
  );
} finally {
  if (original) {
    await database.db
      .update(systemConfig)
      .set({
        value: original.value,
        updatedBy: original.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(systemConfig.key, "bulk_upload_concurrency"));
  } else {
    await database.db
      .delete(systemConfig)
      .where(eq(systemConfig.key, "bulk_upload_concurrency"));
  }
  await database.db
    .delete(sessions)
    .where(inArray(sessions.userId, [ownerId, adminId]));
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, [ownerId, adminId]));
  await database.db.delete(users).where(inArray(users.id, [ownerId, adminId]));
  await app.close();
  await database.sql.end();
}
