import type {
  SeriesInactiveReason,
  SeriesOperationalState,
} from "./series-lifecycle.types.js";

export class SeriesInactiveError extends Error {
  readonly code = "series-inactive";
  constructor() {
    super("The Series is inactive.");
  }
}

export type SeriesOperationalDecision =
  | { allowed: true }
  | { allowed: false; reason: "series-inactive" };

export function evaluateSeriesOperationalMutation(
  state: SeriesOperationalState,
): SeriesOperationalDecision {
  return state === "active"
    ? { allowed: true }
    : { allowed: false, reason: "series-inactive" };
}

export function evaluateSeriesDeactivation(input: {
  state: SeriesOperationalState;
  reason: SeriesInactiveReason;
  reasonDetail?: string | null | undefined;
}):
  | { allowed: true; reasonDetail: string | null }
  | { allowed: false; reason: "series-lifecycle-transition-invalid" } {
  const reasonDetail = input.reasonDetail?.trim() || null;
  if (input.state !== "active" || (input.reason === "other" && !reasonDetail))
    return { allowed: false, reason: "series-lifecycle-transition-invalid" };
  return { allowed: true, reasonDetail };
}

export function evaluateSeriesReactivation(
  state: SeriesOperationalState,
):
  | { allowed: true }
  | { allowed: false; reason: "series-lifecycle-transition-invalid" } {
  return state === "inactive"
    ? { allowed: true }
    : { allowed: false, reason: "series-lifecycle-transition-invalid" };
}

export function evaluateSeriesReactivationRequest(
  state: SeriesOperationalState,
):
  | { allowed: true }
  | { allowed: false; reason: "series-lifecycle-transition-invalid" } {
  return evaluateSeriesReactivation(state);
}
