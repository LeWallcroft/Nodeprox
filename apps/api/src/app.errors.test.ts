import { describe, expect, it } from "vitest";
import { AppError } from "./errors/app-error.js";
import { buildApp } from "./app.js";

describe("API error handling", () => {
  it("returns RFC 9457 Problem Details for AppError", async () => {
    const app = buildApp({ logger: false });
    app.get("/test-error", async () => {
      throw new AppError({
        code: "test-error",
        detail: "The test request failed.",
        statusCode: 409,
        title: "Test error",
        type: "https://nodeprox.dev/problems/test-error",
      });
    });

    const response = await app.inject({ method: "GET", url: "/test-error" });

    expect(response.statusCode).toBe(409);
    expect(response.headers["content-type"]).toContain(
      "application/problem+json",
    );
    expect(response.json()).toMatchObject({
      code: "test-error",
      status: 409,
      title: "Test error",
      type: "https://nodeprox.dev/problems/test-error",
    });
    await app.close();
  });
});
