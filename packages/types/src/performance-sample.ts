export type PerformanceStageV1 =
  | "next-ssr"
  | "api-http"
  | "browser-web-vital"
  | "media-network";

export type PerformanceOutcomeV1 = "success" | "failure" | "aborted";

export type PerformanceMetricV1 =
  | "http.request.duration"
  | "ssr.render.duration"
  | "browser.lcp"
  | "browser.inp"
  | "browser.cls"
  | "browser.long_task.duration"
  | "browser.navigation.ttfb"
  | "ssr.bootstrap.duration"
  | "media.image.transfer.duration"
  | "media.image.transfer.bytes";

export type PerformanceRouteTemplateV1 =
  | "/dashboard"
  | "/series"
  | "/series/:seriesId"
  | "/series/:seriesId/chapters/:chapterId/images"
  | "/series/:seriesId/chapters"
  | "/api/health"
  | "/api/series"
  | "/api/series/:seriesId"
  | "/api/series/:seriesId/chapters"
  | "/api/chapters/:chapterId/images"
  | "/api/other"
  | "/other";

export type PerformanceSampleV1 = Readonly<{
  schemaVersion: 1;
  stage: PerformanceStageV1;
  routeTemplate: PerformanceRouteTemplateV1;
  metric: PerformanceMetricV1;
  durationMs: number;
  outcome: PerformanceOutcomeV1;
  timeBucket: string;
}>;

export interface PerformanceObserverPort {
  record(sample: PerformanceSampleV1): void;
}
