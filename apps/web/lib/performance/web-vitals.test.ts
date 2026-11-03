import type { PerformanceSampleV1 } from "@nodeprox/types";
import { describe, expect, it, vi } from "vitest";
import {
  createBrowserPerformanceObserver,
  safeBrowserRouteTemplate,
} from "./web-vitals";

describe("browser performance telemetry", () => {
  it("maps only known routes and removes identifiers and query strings", () => {
    expect(
      safeBrowserRouteTemplate("/series/secret/chapters/private/images"),
    ).toBe("/series/:seriesId/chapters/:chapterId/images");
    expect(safeBrowserRouteTemplate("/series/secret?token=secret")).toBe(
      "/series/:seriesId",
    );
    expect(safeBrowserRouteTemplate("/other/private/path")).toBe("/other");
  });

  it("validates duration and contains sink failures", () => {
    const write = vi.fn((_sample: PerformanceSampleV1) => {
      throw new Error("sink");
    });
    const observer = createBrowserPerformanceObserver(
      write,
      () => new Date("2026-11-02T12:30:00Z"),
    );
    const sample = {
      schemaVersion: 1 as const,
      stage: "browser-web-vital" as const,
      routeTemplate: "/series/:seriesId" as const,
      metric: "browser.lcp" as const,
      durationMs: 10,
      outcome: "success" as const,
      timeBucket: "unused",
    };
    expect(() => observer.record(sample)).not.toThrow();
    observer.record({ ...sample, durationMs: -1 });
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0].timeBucket).toBe("2026-11-02T12:30");
  });
});
