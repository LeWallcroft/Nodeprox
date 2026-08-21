import { describe, expect, it } from "vitest";
import {
  loadConfig,
  loadDatabaseConfig,
} from "../../packages/config/src/index.js";

describe("NodeProx configuration", () => {
  it("loads the required runtime configuration", () => {
    const config = loadConfig({
      DATABASE_URL: "postgres://nodeprox:nodeprox@localhost:5432/nodeprox",
      REDIS_URL: "redis://localhost:6379",
    });

    expect(config).toMatchObject({
      API_HOST: "127.0.0.1",
      API_PORT: 3000,
      LOG_LEVEL: "info",
      NODE_ENV: "development",
    });
  });

  it("rejects missing infrastructure configuration", () => {
    expect(() => loadConfig({})).toThrow();
  });

  it("loads database configuration without requiring Redis", () => {
    expect(
      loadDatabaseConfig({
        DATABASE_URL: "postgres://nodeprox:nodeprox@localhost:5432/nodeprox",
      }),
    ).toEqual({
      DATABASE_URL: "postgres://nodeprox:nodeprox@localhost:5432/nodeprox",
    });
  });

  it("rejects database configuration without DATABASE_URL", () => {
    expect(() => loadDatabaseConfig({})).toThrow();
  });
});
