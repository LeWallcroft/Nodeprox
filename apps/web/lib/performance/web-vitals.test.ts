import { describe, expect, it, vi } from "vitest";
import {
  createBrowserPerformanceBuffer,
  safeBrowserNavigationRoute,
  safeBrowserRouteTemplate,
} from "./web-vitals";

const sample = {
  schemaVersion: 1 as const,
  stage: "media-network" as const,
  routeTemplate: "/series/:seriesId/chapters/:chapterId/images" as const,
  metric: "media.image.transfer.duration" as const,
  value: 12,
  unit: "ms" as const,
  outcome: "success" as const,
  navigationKind: "spa" as const,
  timeBucket: "2026-11-02T12:00",
};

describe("browser performance telemetry", () => {
  it("attributes document and soft-navigation URLs only through the route allowlist", () => {
    expect(
      safeBrowserNavigationRoute(
        "https://nodeprox.test/series/private-series/chapters/secret/images?token=secret",
        "/login",
      ),
    ).toBe("/series/:seriesId/chapters/:chapterId/images");
    expect(safeBrowserNavigationRoute(undefined, "/login")).toBe("/login");
    expect(
      safeBrowserNavigationRoute("https://bad.test/private/id", "/login"),
    ).toBe("/other");
    expect(safeBrowserRouteTemplate("/series/secret?token=secret")).toBe(
      "/series/:seriesId",
    );
  });

  it("emits one bounded batch per document and ignores later records", () => {
    const write = vi.fn();
    const observer = createBrowserPerformanceBuffer(write, 3);
    for (let index = 0; index < 5; index++)
      observer.record({ ...sample, value: index + 1 });
    observer.flush();
    observer.record({ ...sample, value: 99 });
    observer.flush();
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      dropped: 2,
      samples: [expect.any(Object), expect.any(Object), expect.any(Object)],
    });
  });

  it("drops invalid units and sensitive extra properties before buffering", () => {
    const write = vi.fn();
    const observer = createBrowserPerformanceBuffer(write);
    observer.record({ ...sample, unit: "score" } as never);
    observer.record({ ...sample, userId: "private-id" } as never);
    observer.flush();
    expect(write).not.toHaveBeenCalled();
  });
});
