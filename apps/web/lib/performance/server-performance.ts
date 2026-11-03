import { performance } from "node:perf_hooks";
import type {
  PerformanceObserverPort,
  PerformanceSampleV1,
} from "@nodeprox/types";

export function createServerPerformanceObserver(
  enabled = process.env.NODEPROX_WEB_PERF_ENABLED === "true",
  write: (sample: PerformanceSampleV1) => void = (sample) => {
    console.info("performance.sample", sample);
  },
): PerformanceObserverPort {
  if (!enabled) return { record() {} };
  return {
    record(sample) {
      if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) return;
      try {
        write(sample);
      } catch {
        // SSR behavior cannot depend on its observer.
      }
    },
  };
}

export function startSsrBootstrapMeasurement(
  observer: PerformanceObserverPort,
  now: () => number = () => performance.now(),
): (outcome: "success" | "failure") => void {
  const startedAt = now();
  let recorded = false;
  return (outcome) => {
    if (recorded) return;
    recorded = true;
    try {
      observer.record({
        schemaVersion: 1,
        stage: "next-ssr",
        routeTemplate: "/dashboard",
        metric: "ssr.bootstrap.duration",
        durationMs: Math.max(0, now() - startedAt),
        outcome,
        timeBucket: new Date().toISOString().slice(0, 16),
      });
    } catch {
      // SSR behavior cannot depend on its observer.
    }
  };
}
