import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import {
  Argon2PasswordHasher,
  UserRepository,
} from "../../apps/api/src/modules/authentication/index.js";
import { DrizzleAuthorizationRepository } from "../../apps/api/src/modules/authorization/infrastructure/persistence/drizzle/authorization.repository.js";
import { createDatabase } from "../../database/client.js";
import { auditLogs, systemConfig, users } from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const email = `authorization-${randomUUID()}@example.com`;
const password = "authorization-test-password";
const userId = randomUUID();
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);

beforeAll(async () => {
  await new UserRepository(database.db).create({
    id: userId,
    email,
    passwordHash: await new Argon2PasswordHasher().hash(password),
    status: "active",
    role: "admin",
  });
});

afterAll(async () => {
  await database.db.delete(auditLogs).where(eq(auditLogs.actorId, userId));
  await database.db.delete(users).where(eq(users.id, userId));
  await app.close();
  await database.sql.end();
});

describe("M2-A authorization foundation", () => {
  it("projects server-resolved capabilities after Authentication populates RequestContext", async () => {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    expect(login.statusCode).toBe(204);
    const cookie = login.headers["set-cookie"];
    const response = await app.inject({
      method: "GET",
      url: "/auth/capabilities",
      headers: { cookie: Array.isArray(cookie) ? cookie[0] : cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().capabilities).toContain("admin.system.manage");
    expect(response.body).not.toContain("nodeprox_session");
  });

  it("reads the authorized cooldown from PostgreSQL", async () => {
    const repository = new DrizzleAuthorizationRepository(database.db);
    await expect(repository.getHelperCooldownDays()).resolves.toBe(7);
    const config = await database.db
      .select()
      .from(systemConfig)
      .where(eq(systemConfig.key, "helper_cooldown_days"));
    expect(config).toHaveLength(1);
  });

  it("assigns uploader to a new user while preserving an explicit admin role", async () => {
    const newUserId = randomUUID();
    const adminId = randomUUID();
    await database.db.insert(users).values([
      {
        id: newUserId,
        email: `new-${newUserId}@example.com`,
        passwordHash: "test",
        status: "active",
      },
      {
        id: adminId,
        email: `admin-${adminId}@example.com`,
        passwordHash: "test",
        status: "active",
        role: "admin",
      },
    ]);
    const rows = await database.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, newUserId));
    const adminRows = await database.db
      .select({ id: users.id, role: users.role })
      .from(users)
      .where(eq(users.id, adminId));
    expect(rows[0]?.role).toBe("uploader");
    expect(adminRows[0]?.role).toBe("admin");
    await database.db.delete(users).where(eq(users.id, newUserId));
    await database.db.delete(users).where(eq(users.id, adminId));
  });

  it("persists sensitive authorization audit events without secrets", async () => {
    const repository = new DrizzleAuthorizationRepository(database.db);
    await repository.append({
      actorId: userId,
      action: "role_changed",
      resourceType: "user",
      resourceId: userId,
      metadata: { fromRole: "uploader", toRole: "admin" },
    });
    const records = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, userId));
    expect(records.at(-1)).toMatchObject({
      action: "role_changed",
      resourceType: "user",
    });
    expect(records.at(-1)?.metadata).not.toHaveProperty("password");
    expect(records.at(-1)?.metadata).not.toHaveProperty("token");
  });
});
