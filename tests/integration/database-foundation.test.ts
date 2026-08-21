import { createClient } from "redis";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createDatabase } from "../../database/client.js";
import { withTransaction } from "../../database/transaction.js";
import { bootstrapMetadata } from "../../database/schema/bootstrap.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const redis = createClient({ url: infrastructure.redisUrl });

afterAll(async () => {
  await redis.quit();
  await database.sql.end();
});

describe("database foundation", () => {
  it("runs migrations and verifies PostgreSQL", async () => {
    await migrate(database.db, { migrationsFolder: "database/migrations" });

    let result: (typeof bootstrapMetadata.$inferSelect)[] = [];

    await expect(
      withTransaction(database.db, async (transaction) => {
        await transaction
          .insert(bootstrapMetadata)
          .values({ id: "integration-test" });
        result = await transaction.select().from(bootstrapMetadata);
        throw new Error("rollback integration test");
      }),
    ).rejects.toThrow("rollback integration test");

    expect(result.some((row) => row.id === "integration-test")).toBe(true);
    const persisted = await database.db.select().from(bootstrapMetadata);
    expect(persisted.some((row) => row.id === "integration-test")).toBe(false);
  });

  it("verifies Redis is reachable", async () => {
    await redis.connect();
    await expect(redis.ping()).resolves.toBe("PONG");
  });
});
