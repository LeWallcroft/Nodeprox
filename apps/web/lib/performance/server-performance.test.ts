import { describe, expect, it, vi } from "vitest";
import {
  createServerPerformanceObserver,
  startSsrBootstrapMeasurement,
} from "./server-performance";

describe("SSR bootstrap performance observer", () => {
  it("is disabled by default and emits a bounded SSR sample when enabled", () => {
    const write = vi.fn();
    const disabled = createServerPerformanceObserver(false, write);
    disabled.record({
      schemaVersion: 1,
      stage: "next-ssr",
      routeTemplate: "/dashboard",
      metric: "ssr.bootstrap.duration",
      durationMs: 2,
      outcome: "success",
      timeBucket: "2026-11-02T12:00",
    });
    expect(write).not.toHaveBeenCalled();

    let time = 10;
    const observer = createServerPerformanceObserver(true, write);
    const finish = startSsrBootstrapMeasurement(observer, () => time);
    time = 17;
    finish("success");
    finish("failure");
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]?.[0]).toMatchObject({
      stage: "next-ssr",
      routeTemplate: "/dashboard",
      durationMs: 7,
      outcome: "success",
    });
  });
});
