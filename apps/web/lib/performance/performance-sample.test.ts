import { isValidPerformanceSampleV1 } from "@nodeprox/types";
import { describe, expect, it } from "vitest";

const base = {
  schemaVersion: 1,
  routeTemplate: "/series/:seriesId/chapters/:chapterId/images",
  outcome: "success",
  timeBucket: "2026-11-02T12:00",
};

describe("PerformanceSampleV1 units and fields", () => {
  it("accepts metric-specific milliseconds, score, bytes and HTTP classes", () => {
    expect(
      isValidPerformanceSampleV1({
        ...base,
        stage: "browser-web-vital",
        metric: "browser.inp",
        value: 174,
        unit: "ms",
        navigationKind: "spa",
      }),
    ).toBe(true);
    expect(
      isValidPerformanceSampleV1({
        ...base,
        stage: "browser-web-vital",
        metric: "browser.cls",
        value: 0.12,
        unit: "score",
        navigationKind: "document",
      }),
    ).toBe(true);
    expect(
      isValidPerformanceSampleV1({
        ...base,
        stage: "media-network",
        metric: "media.image.transfer.bytes",
        value: 4_096,
        unit: "bytes",
        navigationKind: "spa",
      }),
    ).toBe(true);
    expect(
      isValidPerformanceSampleV1({
        ...base,
        stage: "api-http",
        metric: "http.request.duration",
        value: 12,
        unit: "ms",
        httpStatusClass: "4xx",
      }),
    ).toBe(true);
  });

  it("rejects unit/metric mismatches, invalid values, status and leaked fields", () => {
    const valid = {
      ...base,
      stage: "media-network",
      metric: "media.image.transfer.bytes",
      value: 4_096,
      unit: "bytes",
      navigationKind: "spa",
    };
    expect(isValidPerformanceSampleV1({ ...valid, unit: "ms" })).toBe(false);
    expect(isValidPerformanceSampleV1({ ...valid, value: 1.5 })).toBe(false);
    expect(isValidPerformanceSampleV1({ ...valid, value: Number.NaN })).toBe(
      false,
    );
    expect(isValidPerformanceSampleV1({ ...valid, storageKey: "secret" })).toBe(
      false,
    );
    expect(
      isValidPerformanceSampleV1({
        ...valid,
        metric: "http.request.duration",
        stage: "api-http",
        httpStatusClass: "200",
      }),
    ).toBe(false);
    expect(
      isValidPerformanceSampleV1({
        ...base,
        stage: "browser-web-vital",
        metric: "browser.navigation.ttfb",
        value: 10,
        unit: "ms",
        navigationKind: "spa",
      }),
    ).toBe(false);
  });
});
