import { performance } from "node:perf_hooks";
import {
  isValidPerformanceSampleV1,
  type PerformanceObserverPort,
  type PerformanceSampleV1,
} from "@nodeprox/types";
import { isServerPerformanceEnabled } from "./performance-flags";

export function createServerPerformanceObserver(
  enabled = isServerPerformanceEnabled(),
  write: (sample: PerformanceSampleV1) => void = (sample) => {
    console.info("performance.sample", sample);
  },
): PerformanceObserverPort {
  if (!enabled) return { record() {} };
  return {
    record(sample) {
      if (!isValidPerformanceSampleV1(sample)) return;
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
        value: Math.max(0, now() - startedAt),
        unit: "ms",
        outcome,
        timeBucket: new Date().toISOString().slice(0, 16),
      });
    } catch {
      // SSR behavior cannot depend on its observer.
    }
  };
}
