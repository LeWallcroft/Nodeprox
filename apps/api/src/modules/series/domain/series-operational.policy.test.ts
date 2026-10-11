import { describe, expect, it } from "vitest";
import {
  evaluateSeriesDeactivation,
  evaluateSeriesOperationalMutation,
  evaluateSeriesReactivation,
  evaluateSeriesReactivationRequest,
} from "./series-operational.policy.js";

describe("Series operational lifecycle policy", () => {
  it("freezes ordinary mutations for every role through the shared state decision", () => {
    expect(evaluateSeriesOperationalMutation("active")).toEqual({
      allowed: true,
    });
    expect(evaluateSeriesOperationalMutation("inactive")).toEqual({
      allowed: false,
      reason: "series-inactive",
    });
  });

  it("requires detail for Other and preserves an optional detail for other reasons", () => {
    expect(
      evaluateSeriesDeactivation({
        state: "active",
        reason: "other",
        reasonDetail: "  ",
      }),
    ).toEqual({
      allowed: false,
      reason: "series-lifecycle-transition-invalid",
    });
    expect(
      evaluateSeriesDeactivation({
        state: "active",
        reason: "other",
        reasonDetail: " Pausa editorial ",
      }),
    ).toEqual({ allowed: true, reasonDetail: "Pausa editorial" });
    expect(
      evaluateSeriesDeactivation({ state: "active", reason: "hiatus" }),
    ).toEqual({ allowed: true, reasonDetail: null });
    expect(
      evaluateSeriesDeactivation({ state: "inactive", reason: "hiatus" }),
    ).toEqual({
      allowed: false,
      reason: "series-lifecycle-transition-invalid",
    });
  });

  it("only reactivates or requests reactivation from inactive", () => {
    expect(evaluateSeriesReactivation("inactive")).toEqual({ allowed: true });
    expect(evaluateSeriesReactivation("active").allowed).toBe(false);
    expect(evaluateSeriesReactivationRequest("inactive")).toEqual({
      allowed: true,
    });
    expect(evaluateSeriesReactivationRequest("active").allowed).toBe(false);
  });
});
