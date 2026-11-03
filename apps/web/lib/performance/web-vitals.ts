import type {
  PerformanceMetricV1,
  PerformanceObserverPort,
  PerformanceRouteTemplateV1,
  PerformanceSampleV1,
} from "@nodeprox/types";

const allowedRoutes: ReadonlyArray<
  readonly [RegExp, PerformanceRouteTemplateV1]
> = [
  [/^\/dashboard\/?$/, "/dashboard"],
  [/^\/series\/?$/, "/series"],
  [/^\/series\/[^/]+\/?$/, "/series/:seriesId"],
  [/^\/series\/[^/]+\/chapters\/?$/, "/series/:seriesId/chapters"],
  [
    /^\/series\/[^/]+\/chapters\/[^/]+\/images\/?$/,
    "/series/:seriesId/chapters/:chapterId/images",
  ],
];

export function safeBrowserRouteTemplate(
  pathname: string,
): PerformanceRouteTemplateV1 {
  return (
    allowedRoutes.find(([pattern]) => pattern.test(pathname))?.[1] ?? "/other"
  );
}

export function createBrowserPerformanceObserver(
  write: (sample: PerformanceSampleV1) => void,
  now: () => Date = () => new Date(),
): PerformanceObserverPort {
  return {
    record(sample) {
      if (!Number.isFinite(sample.durationMs) || sample.durationMs < 0) return;
      try {
        write({ ...sample, timeBucket: now().toISOString().slice(0, 16) });
      } catch {
        // A telemetry sink cannot affect an interaction.
      }
    },
  };
}

export function installBrowserPerformance(
  observer: PerformanceObserverPort,
  pathname = window.location.pathname,
): () => void {
  const routeTemplate = safeBrowserRouteTemplate(pathname);
  const emit = (
    metric: PerformanceMetricV1,
    durationMs: number,
    stage: "browser-web-vital" | "media-network" = "browser-web-vital",
  ) =>
    observer.record({
      schemaVersion: 1,
      stage,
      routeTemplate,
      metric,
      durationMs,
      outcome: "success",
      timeBucket: "1970-01-01T00:00",
    });
  const observers: PerformanceObserver[] = [];
  let latestLcp = 0;
  const interactionDurations = new Map<number, number>();
  let clsWindowStart = 0;
  let clsWindowEnd = 0;
  let clsWindowValue = 0;
  let maxClsSessionValue = 0;
  let vitalsFlushed = false;
  const flushVitals = () => {
    if (vitalsFlushed) return;
    vitalsFlushed = true;
    if (latestLcp > 0) emit("browser.lcp", latestLcp);
    const durations = [...interactionDurations.values()].sort((a, b) => a - b);
    if (durations.length > 0) {
      const p98Index = Math.max(0, Math.ceil(durations.length * 0.98) - 1);
      emit("browser.inp", durations[p98Index] ?? 0);
    }
    emit("browser.cls", maxClsSessionValue);
  };
  const observe = (
    type: string,
    callback: (entry: PerformanceEntry) => void,
  ) => {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    const perfObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) callback(entry);
    });
    perfObserver.observe({ type, buffered: true });
    observers.push(perfObserver);
  };

  observe("largest-contentful-paint", (entry) => {
    latestLcp = entry.startTime;
  });
  observe("event", (entry) => {
    const event = entry as PerformanceEventTiming & { interactionId: number };
    if (event.interactionId <= 0) return;
    const current = interactionDurations.get(event.interactionId) ?? 0;
    const duration = Math.max(current, event.duration);
    if (interactionDurations.has(event.interactionId)) {
      interactionDurations.set(event.interactionId, duration);
      return;
    }
    if (interactionDurations.size < 256) {
      interactionDurations.set(event.interactionId, duration);
      return;
    }
    let shortestId = 0;
    let shortestDuration = Number.POSITIVE_INFINITY;
    for (const [id, value] of interactionDurations) {
      if (value < shortestDuration) {
        shortestId = id;
        shortestDuration = value;
      }
    }
    if (duration > shortestDuration) {
      interactionDurations.delete(shortestId);
      interactionDurations.set(event.interactionId, duration);
    }
  });
  observe("layout-shift", (entry) => {
    const value = entry as PerformanceEntry & {
      value?: number;
      hadRecentInput?: boolean;
    };
    if (value.hadRecentInput || !Number.isFinite(value.value)) return;
    const shift = value.value ?? 0;
    const time = entry.startTime;
    if (time - clsWindowEnd > 1_000 || time - clsWindowStart > 5_000) {
      maxClsSessionValue = Math.max(maxClsSessionValue, clsWindowValue);
      clsWindowStart = time;
      clsWindowValue = 0;
    }
    if (clsWindowStart === 0) clsWindowStart = time;
    clsWindowEnd = time;
    clsWindowValue += shift;
    maxClsSessionValue = Math.max(maxClsSessionValue, clsWindowValue);
  });
  observe("longtask", (entry) =>
    emit("browser.long_task.duration", entry.duration),
  );
  observe("resource", (entry) => {
    const resource = entry as PerformanceResourceTiming;
    if (resource.initiatorType !== "img") return;
    emit("media.image.transfer.duration", resource.duration, "media-network");
    if (resource.transferSize > 0)
      emit(
        "media.image.transfer.bytes",
        resource.transferSize,
        "media-network",
      );
  });
  const navigation = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navigation) emit("browser.navigation.ttfb", navigation.responseStart);
  window.addEventListener("pagehide", flushVitals, { once: true });
  return () => {
    flushVitals();
    window.removeEventListener("pagehide", flushVitals);
    observers.forEach((perfObserver) => {
      perfObserver.disconnect();
    });
  };
}
