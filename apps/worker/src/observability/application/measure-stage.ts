import { performance } from "node:perf_hooks";
import type {
  PerformanceObserverPort,
  PerformanceStageName,
  TimingSample,
} from "./performance-observer.port.js";
import { safeInvokeNoThrow } from "./safe-invoke-no-throw.js";

export async function measureStage<T>(
  observer: PerformanceObserverPort | undefined,
  stage: PerformanceStageName,
  task: () => Promise<T>,
  details?: () => Pick<TimingSample, "bytes" | "objectOutcome"> &
    Partial<Pick<TimingSample, "outcome">>,
  classifyError?: (error: unknown) => TimingSample["outcome"],
): Promise<T> {
  if (!observer?.enabled) return task();
  const started = performance.now();
  let outcome: TimingSample["outcome"] = "success";
  try {
    return await task();
  } catch (error) {
    outcome = classifyError?.(error) ?? "error";
    throw error;
  } finally {
    safeInvokeNoThrow(() => {
      const extra = details?.();
      return observer.record({
        stage,
        durationMs: Math.max(0, performance.now() - started),
        ...extra,
        outcome: outcome === "success" ? (extra?.outcome ?? outcome) : outcome,
      });
    });
  }
}
