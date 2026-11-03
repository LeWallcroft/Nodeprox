import type {
  PerformanceNavigationKindV1,
  PerformanceObserverPort,
  PerformanceRouteTemplateV1,
  PerformanceSampleV1,
} from "@nodeprox/types";
import { isValidPerformanceSampleV1 } from "@nodeprox/types";
import { type Metric, onCLS, onINP, onLCP, onTTFB } from "web-vitals";

const allowedRoutes: ReadonlyArray<
  readonly [RegExp, PerformanceRouteTemplateV1]
> = [
  [/^\/(?:dashboard)?\/?$/, "/dashboard"],
  [/^\/login\/?$/, "/login"],
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
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? "";
  return (
    allowedRoutes.find(([pattern]) => pattern.test(pathOnly))?.[1] ?? "/other"
  );
}

export function safeBrowserNavigationRoute(
  navigationUrl: string | undefined,
  fallbackPathname: string,
): PerformanceRouteTemplateV1 {
  if (!navigationUrl) return safeBrowserRouteTemplate(fallbackPathname);
  try {
    return safeBrowserRouteTemplate(
      new URL(navigationUrl, "https://nodeprox.invalid").pathname,
    );
  } catch {
    return "/other";
  }
}

export function createBrowserPerformanceBuffer(
  write: (batch: {
    samples: readonly PerformanceSampleV1[];
    dropped: number;
  }) => void,
  capacity = 64,
): PerformanceObserverPort & { flush(): void } {
  let samples: PerformanceSampleV1[] = [];
  let dropped = 0;
  let flushed = false;
  return {
    record(sample) {
      if (flushed || !isValidPerformanceSampleV1(sample)) return;
      if (samples.length >= capacity) {
        dropped++;
        return;
      }
      samples.push(sample);
    },
    flush() {
      if (flushed) return;
      flushed = true;
      if (samples.length === 0 && dropped === 0) return;
      const batch = { samples, dropped };
      samples = [];
      dropped = 0;
      try {
        write(batch);
      } catch {
        // A telemetry sink cannot affect navigation or rendering.
      }
    },
  };
}

function timeBucket(): string {
  return new Date().toISOString().slice(0, 16);
}

function navigationKind(metric: Metric): PerformanceNavigationKindV1 {
  return metric.navigationType === "soft-navigation" ? "spa" : "document";
}

function recordCoreWebVital(
  observer: PerformanceObserverPort,
  metric: Metric,
  fallbackPathname: string,
): void {
  const kind = navigationKind(metric);
  const routeTemplate = safeBrowserNavigationRoute(
    metric.navigationURL,
    fallbackPathname,
  );
  const base = {
    schemaVersion: 1 as const,
    routeTemplate,
    outcome: "success" as const,
    timeBucket: timeBucket(),
    navigationKind: kind,
  };
  if (metric.name === "LCP")
    observer.record({
      ...base,
      stage: "browser-web-vital",
      metric: "browser.lcp",
      value: metric.value,
      unit: "ms",
    });
  else if (metric.name === "INP")
    observer.record({
      ...base,
      stage: "browser-web-vital",
      metric: "browser.inp",
      value: metric.value,
      unit: "ms",
    });
  else if (metric.name === "CLS")
    observer.record({
      ...base,
      stage: "browser-web-vital",
      metric: "browser.cls",
      value: metric.value,
      unit: "score",
    });
  else if (metric.name === "TTFB" && kind === "document")
    observer.record({
      ...base,
      stage: "browser-web-vital",
      metric: "browser.navigation.ttfb",
      value: metric.value,
      unit: "ms",
      navigationKind: "document",
    });
}

/** Register once per document; web-vitals handles INP, CLS and soft-nav lifecycle. */
export function installCoreWebVitals(
  observer: PerformanceObserverPort,
  initialPathname: string,
): void {
  const report = (metric: Metric) =>
    recordCoreWebVital(observer, metric, initialPathname);
  onLCP(report, { reportSoftNavs: true });
  onINP(report, { reportSoftNavs: true });
  onCLS(report, { reportSoftNavs: true });
  onTTFB(report);
}

/** Install bounded per-route resources/long-task observers, replacing them on SPA navigation. */
export function installRoutePerformance(
  observer: PerformanceObserverPort,
  pathname: string,
  kind: PerformanceNavigationKindV1,
  includeBufferedEntries: boolean,
): () => void {
  const routeTemplate = safeBrowserRouteTemplate(pathname);
  const observers: PerformanceObserver[] = [];
  const record = (
    stage: "browser-web-vital" | "media-network",
    metric: PerformanceSampleV1["metric"],
    value: number,
    unit: "ms" | "bytes",
  ) => {
    const sample = {
      schemaVersion: 1 as const,
      stage,
      routeTemplate,
      metric,
      value,
      unit,
      outcome: "success" as const,
      timeBucket: timeBucket(),
      navigationKind: kind,
    };
    if (isValidPerformanceSampleV1(sample)) observer.record(sample);
  };
  const observe = (
    type: string,
    callback: (entry: PerformanceEntry) => void,
  ) => {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
    const perfObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) callback(entry);
    });
    perfObserver.observe(
      includeBufferedEntries ? { type, buffered: true } : { type },
    );
    observers.push(perfObserver);
  };

  observe("longtask", (entry) =>
    record(
      "browser-web-vital",
      "browser.long_task.duration",
      entry.duration,
      "ms",
    ),
  );
  observe("resource", (entry) => {
    const resource = entry as PerformanceResourceTiming;
    if (resource.initiatorType !== "img") return;
    record(
      "media-network",
      "media.image.transfer.duration",
      resource.duration,
      "ms",
    );
    if (resource.transferSize > 0)
      record(
        "media-network",
        "media.image.transfer.bytes",
        resource.transferSize,
        "bytes",
      );
  });
  return () =>
    observers.forEach((perfObserver) => {
      perfObserver.disconnect();
    });
}
