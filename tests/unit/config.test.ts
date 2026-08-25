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
      PUBLIC_MEDIA_ORIGIN: "https://media.nodeprox.org",
    });
  });

  it("validates the public media origin", () => {
    expect(
      loadConfig({
        DATABASE_URL: "postgres://nodeprox:nodeprox@localhost:5432/nodeprox",
        REDIS_URL: "redis://localhost:6379",
        PUBLIC_MEDIA_ORIGIN: "https://media.example.test/",
      }).PUBLIC_MEDIA_ORIGIN,
    ).toBe("https://media.example.test/");
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://nodeprox:nodeprox@localhost:5432/nodeprox",
        REDIS_URL: "redis://localhost:6379",
        PUBLIC_MEDIA_ORIGIN: "https://media.example.test/path",
      }),
    ).toThrow();

    for (const invalidOrigin of [
      "ftp://media.nodeprox.org",
      "https://media.nodeprox.org?foo=bar",
      "https://media.nodeprox.org#section",
    ]) {
      expect(() =>
        loadConfig({
          DATABASE_URL: "postgres://nodeprox:nodeprox@localhost:5432/nodeprox",
          REDIS_URL: "redis://localhost:6379",
          PUBLIC_MEDIA_ORIGIN: invalidOrigin,
        }),
      ).toThrow();
    }
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
