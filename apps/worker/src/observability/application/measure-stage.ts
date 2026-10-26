import { performance } from "node:perf_hooks";
import type {
  PerformanceObserverPort,
  PerformanceStageName,
  TimingSample,
} from "./performance-observer.port.js";

export async function measureStage<T>(
  observer: PerformanceObserverPort | undefined,
  stage: PerformanceStageName,
  task: () => Promise<T>,
  details?: () => Pick<TimingSample, "bytes" | "objectOutcome">,
): Promise<T> {
  if (!observer?.enabled) return task();
  const started = performance.now();
  let outcome: TimingSample["outcome"] = "success";
  try {
    return await task();
  } catch (error) {
    outcome = "error";
    throw error;
  } finally {
    try {
      observer.record({
        stage,
        durationMs: Math.max(0, performance.now() - started),
        outcome,
        ...details?.(),
      });
    } catch {
      // Observability must never change the processing result.
    }
  }
}
