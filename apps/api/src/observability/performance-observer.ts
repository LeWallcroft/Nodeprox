import type {
  PerformanceObserverPort,
  PerformanceSampleV1,
} from "@nodeprox/types";

export const noopPerformanceObserver: PerformanceObserverPort = {
  record() {},
};

/** Synchronous, bounded, best-effort adapter with no retained samples. */
export class BoundedPerformanceObserver implements PerformanceObserverPort {
  constructor(private readonly emit: (sample: PerformanceSampleV1) => void) {}

  record(sample: PerformanceSampleV1): void {
    if (
      !Number.isFinite(sample.durationMs) ||
      sample.durationMs < 0 ||
      sample.routeTemplate.length > 80 ||
      sample.metric.length > 64 ||
      sample.timeBucket.length > 20
    )
      return;
    try {
      this.emit(sample);
    } catch {
      // Observability must never affect the measured operation.
    }
  }
}
