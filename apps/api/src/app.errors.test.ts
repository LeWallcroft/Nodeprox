import { describe, expect, it } from "vitest";
import { AppError } from "./errors/app-error.js";
import { ExternalDependencyFailure } from "./errors/technical-failure.js";
import { buildApp } from "./app.js";
import {
  markOperationAuditRecorded,
  setOperationAuditContext,
} from "./plugins/request-context.js";
import type { OperationAuditWriter } from "./observability/operation-audit-writer.js";

function createAuditWriter() {
  const events: Parameters<OperationAuditWriter["append"]>[0][] = [];
  const writer: OperationAuditWriter = {
    append: async (event) => {
      events.push(event);
    },
  };
  return { events, writer };
}

describe("API error handling", () => {
  it("returns a safe 503 for a typed provider failure", async () => {
    const app = buildApp({ logger: false });
    app.get("/provider-error", async () => {
      throw new ExternalDependencyFailure({
        code: "brevo-delivery-failed",
        dependency: "brevo",
        retryable: true,
        providerRequestId: "secret-provider-reference",
        cause: new Error("API key leaked in provider response"),
      });
    });
    const response = await app.inject({
      method: "GET",
      url: "/provider-error",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: "external-dependency-unavailable",
      category: "external_dependency",
      requestId: response.headers["x-request-id"],
    });
    expect(response.body).not.toContain("secret-provider-reference");
    expect(response.body).not.toContain("API key leaked");
    await app.close();
  });

  it("does not interpret an unknown SQL unique violation as a business conflict", async () => {
    const app = buildApp({ logger: false });
    app.get("/unknown-unique", async () => {
      throw { cause: { code: "23505", constraint: "unknown_unique" } };
    });
    const response = await app.inject({
      method: "GET",
      url: "/unknown-unique",
    });
    expect(response.statusCode).toBe(500);
    expect(response.json().code).toBe("internal-error");
    await app.close();
  });

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
      category: "conflict",
      status: 409,
      title: "Test error",
      type: "https://nodeprox.dev/problems/test-error",
    });
    expect(response.headers["x-request-id"]).toBeTruthy();
    expect(response.json().requestId).toBe(response.headers["x-request-id"]);
    await app.close();
  });

  it("keeps unexpected failures generic while returning the same request reference", async () => {
    const app = buildApp({ logger: false });
    app.get("/unhandled", async () => {
      throw new Error("DATABASE_URL=secret-value");
    });

    const response = await app.inject({ method: "GET", url: "/unhandled" });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      code: "internal-error",
      category: "internal",
      detail: "An unexpected error occurred.",
    });
    expect(response.json().detail).not.toContain("secret-value");
    expect(response.json().requestId).toBe(response.headers["x-request-id"]);
    await app.close();
  });

  it("writes one rejected audit event when an operation context is explicit", async () => {
    const audit = createAuditWriter();
    const app = buildApp(
      { logger: false },
      { operationAuditWriter: audit.writer },
    );
    app.get("/contextual-conflict", async () => {
      setOperationAuditContext({
        action: "chapter.created",
        resourceType: "chapter",
        resourceId: "11111111-1111-4111-8111-111111111111",
        seriesId: "22222222-2222-4222-8222-222222222222",
      });
      throw new AppError({
        code: "chapter-conflict",
        detail: "A chapter with this number already exists in the series.",
        statusCode: 409,
        title: "Chapter conflict",
        type: "https://nodeprox.dev/problems/chapter-conflict",
      });
    });

    const response = await app.inject({
      method: "GET",
      url: "/contextual-conflict",
    });

    expect(response.statusCode).toBe(409);
    expect(audit.events).toEqual([
      expect.objectContaining({
        requestId: response.headers["x-request-id"],
        result: "rejected",
        reasonCode: "chapter-conflict",
        operation: expect.objectContaining({ action: "chapter.created" }),
      }),
    ]);
    await app.close();
  });

  it("does not invent an audit event when an AppError has no operation context", async () => {
    const audit = createAuditWriter();
    const app = buildApp(
      { logger: false },
      { operationAuditWriter: audit.writer },
    );
    app.get("/unscoped-conflict", async () => {
      throw new AppError({
        code: "chapter-conflict",
        detail: "A chapter with this number already exists in the series.",
        statusCode: 409,
        title: "Chapter conflict",
        type: "https://nodeprox.dev/problems/chapter-conflict",
      });
    });

    const response = await app.inject({
      method: "GET",
      url: "/unscoped-conflict",
    });

    expect(response.statusCode).toBe(409);
    expect(audit.events).toEqual([]);
    await app.close();
  });

  it("records a failed audit event for a technical failure with explicit context", async () => {
    const audit = createAuditWriter();
    const app = buildApp(
      { logger: false },
      { operationAuditWriter: audit.writer },
    );
    app.get("/contextual-failure", async () => {
      setOperationAuditContext({
        action: "chapter.created",
        resourceType: "chapter",
      });
      throw new Error("database connection lost");
    });

    const response = await app.inject({
      method: "GET",
      url: "/contextual-failure",
    });

    expect(response.statusCode).toBe(500);
    expect(audit.events).toEqual([
      expect.objectContaining({
        result: "failed",
        reasonCode: "internal-error",
      }),
    ]);
    await app.close();
  });

  it("does not duplicate an audit event already written by a successful operation", async () => {
    const audit = createAuditWriter();
    const app = buildApp(
      { logger: false },
      { operationAuditWriter: audit.writer },
    );
    app.get("/successful-operation", async () => {
      setOperationAuditContext({
        action: "chapter.created",
        resourceType: "chapter",
      });
      markOperationAuditRecorded();
      return { created: true };
    });

    const response = await app.inject({
      method: "GET",
      url: "/successful-operation",
    });

    expect(response.statusCode).toBe(200);
    expect(audit.events).toEqual([]);
    await app.close();
  });
});
