import { describe, expect, it } from "vitest";
import {
  isBrowserPerformanceEnabled,
  isServerPerformanceEnabled,
} from "./performance-flags";

describe("performance flag scopes", () => {
  it("keeps browser and SSR flags independently disabled unless exactly true", () => {
    expect(isBrowserPerformanceEnabled(undefined)).toBe(false);
    expect(isBrowserPerformanceEnabled("1")).toBe(false);
    expect(isBrowserPerformanceEnabled("true")).toBe(true);
    expect(isServerPerformanceEnabled({})).toBe(false);
    expect(
      isServerPerformanceEnabled({ NODEPROX_WEB_PERF_ENABLED: "true" }),
    ).toBe(true);
  });
});
