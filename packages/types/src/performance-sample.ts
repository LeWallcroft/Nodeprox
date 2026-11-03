export type PerformanceOutcomeV1 = "success" | "failure" | "aborted";
export type PerformanceHttpStatusClassV1 =
  | "1xx"
  | "2xx"
  | "3xx"
  | "4xx"
  | "5xx";
export type PerformanceNavigationKindV1 = "document" | "spa";

export type PerformanceRouteTemplateV1 =
  | "/dashboard"
  | "/login"
  | "/series"
  | "/series/:seriesId"
  | "/series/:seriesId/chapters"
  | "/series/:seriesId/chapters/:chapterId/images"
  | "/api/health"
  | "/api/series"
  | "/api/series/:seriesId"
  | "/api/series/:seriesId/chapters"
  | "/api/chapters/:chapterId/images"
  | "/api/other"
  | "/other";

type SampleCommon = Readonly<{
  schemaVersion: 1;
  routeTemplate: PerformanceRouteTemplateV1;
  outcome: PerformanceOutcomeV1;
  timeBucket: string;
}>;

export type PerformanceSampleV1 =
  | (SampleCommon & {
      stage: "api-http";
      metric: "http.request.duration";
      value: number;
      unit: "ms";
      httpStatusClass: PerformanceHttpStatusClassV1;
    })
  | (SampleCommon & {
      stage: "next-ssr";
      metric: "ssr.bootstrap.duration";
      value: number;
      unit: "ms";
    })
  | (SampleCommon & {
      stage: "browser-web-vital";
      metric:
        | "browser.lcp"
        | "browser.inp"
        | "browser.navigation.ttfb"
        | "browser.long_task.duration";
      value: number;
      unit: "ms";
      navigationKind: PerformanceNavigationKindV1;
    })
  | (SampleCommon & {
      stage: "browser-web-vital";
      metric: "browser.cls";
      value: number;
      unit: "score";
      navigationKind: PerformanceNavigationKindV1;
    })
  | (SampleCommon & {
      stage: "media-network";
      metric: "media.image.transfer.duration";
      value: number;
      unit: "ms";
      navigationKind: PerformanceNavigationKindV1;
    })
  | (SampleCommon & {
      stage: "media-network";
      metric: "media.image.transfer.bytes";
      value: number;
      unit: "bytes";
      navigationKind: PerformanceNavigationKindV1;
    });

export interface PerformanceObserverPort {
  record(sample: PerformanceSampleV1): void;
}

const routes = new Set<PerformanceRouteTemplateV1>([
  "/dashboard",
  "/login",
  "/series",
  "/series/:seriesId",
  "/series/:seriesId/chapters",
  "/series/:seriesId/chapters/:chapterId/images",
  "/api/health",
  "/api/series",
  "/api/series/:seriesId",
  "/api/series/:seriesId/chapters",
  "/api/chapters/:chapterId/images",
  "/api/other",
  "/other",
]);

const minuteBucket = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const statusClasses = new Set<PerformanceHttpStatusClassV1>([
  "1xx",
  "2xx",
  "3xx",
  "4xx",
  "5xx",
]);

/** Runtime boundary validation for adapters receiving JS or deserialized values. */
export function isValidPerformanceSampleV1(
  value: unknown,
): value is PerformanceSampleV1 {
  if (!value || typeof value !== "object") return false;
  const sample = value as Record<string, unknown>;
  const allowedFields = new Set([
    "schemaVersion",
    "stage",
    "routeTemplate",
    "metric",
    "value",
    "unit",
    "outcome",
    "timeBucket",
    ...(sample.stage === "api-http" ? ["httpStatusClass"] : []),
    ...(["browser-web-vital", "media-network"].includes(String(sample.stage))
      ? ["navigationKind"]
      : []),
  ]);
  if (Object.keys(sample).some((key) => !allowedFields.has(key))) return false;
  if (
    sample.schemaVersion !== 1 ||
    typeof sample.routeTemplate !== "string" ||
    !routes.has(sample.routeTemplate as PerformanceRouteTemplateV1) ||
    !["success", "failure", "aborted"].includes(String(sample.outcome)) ||
    typeof sample.timeBucket !== "string" ||
    !minuteBucket.test(sample.timeBucket) ||
    typeof sample.value !== "number" ||
    !Number.isFinite(sample.value) ||
    sample.value < 0
  )
    return false;

  if (sample.stage === "api-http")
    return (
      sample.metric === "http.request.duration" &&
      sample.unit === "ms" &&
      statusClasses.has(
        sample.httpStatusClass as PerformanceHttpStatusClassV1,
      ) &&
      sample.navigationKind === undefined
    );
  if (sample.stage === "next-ssr")
    return (
      sample.metric === "ssr.bootstrap.duration" &&
      sample.unit === "ms" &&
      sample.httpStatusClass === undefined &&
      sample.navigationKind === undefined
    );
  if (sample.navigationKind !== "document" && sample.navigationKind !== "spa")
    return false;
  if (sample.stage === "browser-web-vital") {
    if (sample.httpStatusClass !== undefined) return false;
    if (sample.metric === "browser.cls") return sample.unit === "score";
    if (
      sample.metric === "browser.navigation.ttfb" &&
      sample.navigationKind !== "document"
    )
      return false;
    return (
      [
        "browser.lcp",
        "browser.inp",
        "browser.navigation.ttfb",
        "browser.long_task.duration",
      ].includes(String(sample.metric)) && sample.unit === "ms"
    );
  }
  if (sample.stage === "media-network")
    return (
      sample.httpStatusClass === undefined &&
      ((sample.metric === "media.image.transfer.duration" &&
        sample.unit === "ms") ||
        (sample.metric === "media.image.transfer.bytes" &&
          sample.unit === "bytes" &&
          Number.isInteger(sample.value)))
    );
  return false;
}
