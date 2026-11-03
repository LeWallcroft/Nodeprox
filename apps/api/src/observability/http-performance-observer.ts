import { performance } from "node:perf_hooks";
import type {
  PerformanceObserverPort,
  PerformanceRouteTemplateV1,
  PerformanceSampleV1,
} from "@nodeprox/types";
import type { FastifyInstance } from "fastify";
import {
  BoundedPerformanceObserver,
  noopPerformanceObserver,
} from "./performance-observer.js";

const routes: ReadonlyArray<readonly [RegExp, PerformanceRouteTemplateV1]> = [
  [/^(?:\/api)?\/health\/?$/, "/api/health"],
  [/^(?:\/api)?\/series\/?$/, "/api/series"],
  [/^(?:\/api)?\/series\/[^/]+\/?$/, "/api/series/:seriesId"],
  [
    /^(?:\/api)?\/series\/[^/]+\/chapters\/?$/,
    "/api/series/:seriesId/chapters",
  ],
  [
    /^(?:\/api)?\/chapters\/[^/]+\/images\/?$/,
    "/api/chapters/:chapterId/images",
  ],
];

export function safeApiRouteTemplate(
  route: string | undefined,
): PerformanceRouteTemplateV1 {
  if (!route) return "/api/other";
  const path = route.split("?", 1)[0] ?? "";
  return routes.find(([pattern]) => pattern.test(path))?.[1] ?? "/api/other";
}

export function createApiPerformanceObserver(
  input: {
    environment?: Readonly<Record<string, string | undefined>>;
    emit?: (sample: PerformanceSampleV1) => void;
  } = {},
): PerformanceObserverPort {
  const env = input.environment ?? process.env;
  if (env.NODEPROX_API_PERF_ENABLED !== "true") return noopPerformanceObserver;
  const rawRate = env.NODEPROX_API_PERF_SAMPLE_RATE;
  const sampleRate = rawRate === undefined ? 1 : Number(rawRate);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    return noopPerformanceObserver;
  return new BoundedPerformanceObserver(input.emit ?? (() => {}));
}

export function registerHttpPerformanceObserver(
  app: FastifyInstance,
  observer: PerformanceObserverPort,
  random: () => number = Math.random,
): void {
  const env = process.env;
  if (env.NODEPROX_API_PERF_ENABLED !== "true") return;
  const rawRate = env.NODEPROX_API_PERF_SAMPLE_RATE;
  const rate = rawRate === undefined ? 1 : Number(rawRate);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1) return;

  const starts = new WeakMap<object, number>();
  app.addHook("onRequest", (request, _reply, done) => {
    starts.set(request, performance.now());
    done();
  });
  app.addHook("onResponse", (request, reply, done) => {
    const started = starts.get(request);
    if (started === undefined || random() >= rate) return done();
    const status = reply.statusCode;
    const sample: PerformanceSampleV1 = {
      schemaVersion: 1,
      stage: "api-http",
      routeTemplate: safeApiRouteTemplate(request.routeOptions.url),
      metric: "http.request.duration",
      durationMs: Math.max(0, performance.now() - started),
      outcome: request.raw.aborted
        ? "aborted"
        : status >= 400
          ? "failure"
          : "success",
      timeBucket: new Date().toISOString().slice(0, 16),
    };
    try {
      observer.record(sample);
    } catch {
      // A faulty adapter cannot alter the response.
    }
    done();
  });
}
