import type { PerformanceObserverPort } from "../application/performance-observer.port.js";

export const noopPerformanceObserver: PerformanceObserverPort = {
  enabled: false,
  record() {},
  finish() {},
};
