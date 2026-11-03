import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  createApiPerformanceObserver,
  registerHttpPerformanceObserver,
  safeApiRouteTemplate,
} from "./http-performance-observer.js";
import {
  BoundedPerformanceObserver,
  noopPerformanceObserver,
} from "./performance-observer.js";

describe("HTTP performance observer", () => {
  it("is disabled by default and rejects an invalid sample rate", () => {
    expect(createApiPerformanceObserver({ environment: {} })).toBe(
      noopPerformanceObserver,
    );
    expect(
      createApiPerformanceObserver({
        environment: {
          NODEPROX_API_PERF_ENABLED: "true",
          NODEPROX_API_PERF_SAMPLE_RATE: "2",
        },
      }),
    ).toBe(noopPerformanceObserver);
  });

  it("uses only bounded route templates and never emits raw values", () => {
    expect(
      safeApiRouteTemplate(
        "/api/series/secret-series/chapters/private/images?token=secret",
      ),
    ).toBe("/api/other");
    expect(safeApiRouteTemplate("/api/series/:seriesId/chapters")).toBe(
      "/api/series/:seriesId/chapters",
    );
    expect(safeApiRouteTemplate("/series/:seriesId/chapters")).toBe(
      "/api/series/:seriesId/chapters",
    );
  });

  it("contains adapter failures and rejects invalid or oversized records", () => {
    const emit = vi.fn(() => {
      throw new Error("sink failed");
    });
    const observer = new BoundedPerformanceObserver(emit);
    const sample = {
      schemaVersion: 1 as const,
      stage: "api-http" as const,
      routeTemplate: "/api/health" as const,
      metric: "http.request.duration" as const,
      durationMs: 3,
      outcome: "success" as const,
      timeBucket: "2026-11-02T12:00",
    };
    expect(() => observer.record(sample)).not.toThrow();
    expect(() =>
      observer.record({ ...sample, durationMs: Number.NaN }),
    ).not.toThrow();
    expect(emit).toHaveBeenCalledOnce();
  });

  it("records normalized HTTP outcomes without changing status or response body", async () => {
    const previousEnabled = process.env.NODEPROX_API_PERF_ENABLED;
    const previousRate = process.env.NODEPROX_API_PERF_SAMPLE_RATE;
    process.env.NODEPROX_API_PERF_ENABLED = "true";
    process.env.NODEPROX_API_PERF_SAMPLE_RATE = "1";
    const app = Fastify({ logger: false });
    const emit = vi.fn();
    try {
      registerHttpPerformanceObserver(
        app,
        new BoundedPerformanceObserver(emit),
        () => 0,
      );
      app.get("/api/series/:seriesId", async () => ({ ok: true }));
      app.get("/test/denied", async (_request, reply) =>
        reply.code(403).send({ error: "denied" }),
      );
      app.get("/test/failure", async (_request, reply) =>
        reply.code(500).send({ error: "failed" }),
      );
      const success = await app.inject("/api/series/secret-id?token=secret");
      const denied = await app.inject("/test/denied");
      const failure = await app.inject("/test/failure");
      expect(success.statusCode).toBe(200);
      expect(success.json()).toEqual({ ok: true });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toEqual({ error: "denied" });
      expect(failure.statusCode).toBe(500);
      expect(emit.mock.calls.map(([sample]) => sample)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            routeTemplate: "/api/series/:seriesId",
            outcome: "success",
          }),
          expect.objectContaining({
            routeTemplate: "/api/other",
            outcome: "failure",
          }),
        ]),
      );
      expect(JSON.stringify(emit.mock.calls)).not.toMatch(
        /secret-id|token=secret/,
      );
    } finally {
      await app.close();
      if (previousEnabled === undefined)
        delete process.env.NODEPROX_API_PERF_ENABLED;
      else process.env.NODEPROX_API_PERF_ENABLED = previousEnabled;
      if (previousRate === undefined)
        delete process.env.NODEPROX_API_PERF_SAMPLE_RATE;
      else process.env.NODEPROX_API_PERF_SAMPLE_RATE = previousRate;
    }
  });
});
