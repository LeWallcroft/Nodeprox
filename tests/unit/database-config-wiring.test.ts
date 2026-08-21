import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrateScript = readFileSync("database/scripts/migrate.ts", "utf8");
const checkScript = readFileSync(
  "database/scripts/check-connection.ts",
  "utf8",
);
const drizzleConfig = readFileSync("database/drizzle.config.ts", "utf8");
const directDatabaseEnvAccess = ["process.env", "DATABASE_URL"].join(".");

describe("database configuration wiring", () => {
  it("uses the centralized database configuration in CLI scripts", () => {
    expect(migrateScript).toContain("loadDatabaseConfig");
    expect(checkScript).toContain("loadDatabaseConfig");
    expect(migrateScript).not.toContain(directDatabaseEnvAccess);
    expect(checkScript).not.toContain(directDatabaseEnvAccess);
  });

  it("does not keep a hardcoded Drizzle database fallback", () => {
    expect(drizzleConfig).toContain("loadDatabaseConfig");
    expect(drizzleConfig).not.toContain(
      "postgres://nodeprox:nodeprox@127.0.0.1:5432/nodeprox",
    );
  });
});
