import type {
  PerformanceObserverPort,
  PerformanceSampleV1,
} from "@nodeprox/types";
import { isValidPerformanceSampleV1 } from "@nodeprox/types";

export const noopPerformanceObserver: PerformanceObserverPort = {
  record() {},
};

/** Synchronous, bounded, best-effort adapter with no retained samples. */
export class BoundedPerformanceObserver implements PerformanceObserverPort {
  constructor(private readonly emit: (sample: PerformanceSampleV1) => void) {}

  record(sample: PerformanceSampleV1): void {
    if (!isValidPerformanceSampleV1(sample)) return;
    try {
      this.emit(sample);
    } catch {
      // Observability must never affect the measured operation.
    }
  }
}
