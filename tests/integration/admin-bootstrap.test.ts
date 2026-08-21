import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { AdminBootstrapService } from "../../apps/api/src/modules/authorization/application/services/admin-bootstrap.service.js";
import { DrizzleAdminBootstrapStore } from "../../apps/api/src/modules/authorization/infrastructure/bootstrap/drizzle-admin-bootstrap.store.js";
import { createDatabase } from "../../database/client.js";
import { auditLogs, users } from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const email = `bootstrap-${randomUUID()}@example.com`;
const password = "bootstrap-password";
const service = new AdminBootstrapService(
  new DrizzleAdminBootstrapStore(database.db),
  new Argon2PasswordHasher(),
);

afterAll(async () => {
  const created = await database.db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email));
  for (const user of created) {
    await database.db.delete(auditLogs).where(eq(auditLogs.actorId, user.id));
    await database.db.delete(users).where(eq(users.id, user.id));
  }
  await database.sql.end();
});

describe("administrative bootstrap", () => {
  it("assigns uploader when the role column is added to existing users", async () => {
    const tableName = `m2_role_migration_${randomUUID().replaceAll("-", "")}`;
    await database.sql.unsafe(
      `CREATE TEMP TABLE "${tableName}" ("id" uuid PRIMARY KEY, "email" text NOT NULL)`,
    );
    await database.sql.unsafe(
      `INSERT INTO "${tableName}" ("id", "email") VALUES ('${randomUUID()}', 'existing@example.com')`,
    );
    await database.sql.unsafe(
      `ALTER TABLE "${tableName}" ADD COLUMN "role" "user_role" DEFAULT 'uploader' NOT NULL`,
    );

    const existing = await database.sql.unsafe<{ role: string }[]>(
      `SELECT "role" FROM "${tableName}"`,
    );
    expect(existing[0]?.role).toBe("uploader");
  });

  it("creates one configured admin and is idempotent", async () => {
    const first = await service.run({ email, password });
    const recordsAfterFirst = await database.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, email));
    const originalPasswordHash = recordsAfterFirst[0]?.passwordHash;
    const second = await service.run({
      email,
      password: "must-not-reset-existing-password",
    });

    expect(first.outcome).toBe("created");
    expect(second).toMatchObject({
      outcome: "already-admin",
      userId: first.userId,
    });
    const records = await database.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    expect(records).toHaveLength(1);
    expect(records[0]?.role).toBe("admin");
    expect(records[0]?.passwordHash).toBe(originalPasswordHash);
    const passwordHash = records[0]?.passwordHash;
    expect(passwordHash).toBeDefined();
    await expect(
      new Argon2PasswordHasher().verify(passwordHash ?? "", password),
    ).resolves.toBe(true);
  });

  it("serializes concurrent bootstrap executions for one identity", async () => {
    const concurrentEmail = `concurrent-${randomUUID()}@example.com`;
    const results = await Promise.all([
      service.run({ email: concurrentEmail, password: "first-password" }),
      service.run({ email: concurrentEmail, password: "second-password" }),
    ]);
    const records = await database.db
      .select()
      .from(users)
      .where(eq(users.email, concurrentEmail));
    const events = records[0]
      ? await database.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.actorId, records[0].id))
      : [];

    expect(results).toHaveLength(2);
    expect(records).toHaveLength(1);
    expect(records[0]?.role).toBe("admin");
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.metadata)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("first-password");
    expect(JSON.stringify(events)).not.toContain("second-password");

    if (records[0]) {
      await database.db
        .delete(auditLogs)
        .where(eq(auditLogs.actorId, records[0].id));
      await database.db.delete(users).where(eq(users.id, records[0].id));
    }
  });

  it("promotes only the configured existing user", async () => {
    const otherId = randomUUID();
    await database.db.insert(users).values({
      id: otherId,
      email: `other-${otherId}@example.com`,
      passwordHash: "not-used",
      status: "active",
    });
    const result = await service.run({ email, password });
    const other = await database.db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, otherId));

    expect(result.outcome).toBe("already-admin");
    expect(other[0]?.role).toBe("uploader");
    await database.db.delete(users).where(eq(users.id, otherId));
  });
});
