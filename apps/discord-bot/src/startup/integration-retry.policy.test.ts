import { describe, expect, it, vi } from "vitest";
import { NodeProxApiError } from "../infrastructure/nodeprox-api/nodeprox-api.client.js";
import {
  DEFAULT_STARTUP_RETRY_POLICY,
  startupRetryErrorDetails,
} from "./integration-retry.policy.js";

describe("startup integration retry policy", () => {
  it.each([0, 500, 503])("retries transient status %s", (status) => {
    expect(
      DEFAULT_STARTUP_RETRY_POLICY.shouldRetry(
        new NodeProxApiError(null, status),
        1,
        0,
      ),
    ).toBe(true);
  });

  it.each([401, 403, 400, 409])("fails fast for status %s", (status) => {
    expect(
      DEFAULT_STARTUP_RETRY_POLICY.shouldRetry(
        new NodeProxApiError(null, status),
        1,
        0,
      ),
    ).toBe(false);
  });

  it("caps retries by attempts and elapsed startup budget", () => {
    expect(
      DEFAULT_STARTUP_RETRY_POLICY.shouldRetry(
        new NodeProxApiError(null, 0),
        DEFAULT_STARTUP_RETRY_POLICY.maxAttempts,
        0,
      ),
    ).toBe(false);
    expect(
      DEFAULT_STARTUP_RETRY_POLICY.shouldRetry(
        new NodeProxApiError(null, 0),
        1,
        30_000,
      ),
    ).toBe(false);
  });

  it("uses increasing bounded jittered delays", () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(DEFAULT_STARTUP_RETRY_POLICY.delayMs(1)).toBe(500);
    expect(DEFAULT_STARTUP_RETRY_POLICY.delayMs(2)).toBe(1_000);
    expect(DEFAULT_STARTUP_RETRY_POLICY.delayMs(99)).toBe(8_000);
    random.mockRestore();
  });

  it("logs only safe error classification fields", () => {
    expect(startupRetryErrorDetails(new NodeProxApiError(null, 0))).toEqual({
      status: 0,
      category: "transport",
    });
  });
});
