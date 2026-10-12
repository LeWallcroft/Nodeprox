import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type {
  SeriesInactiveReason,
  SeriesOperationalState,
} from "../../domain/series-lifecycle.types.js";

export type SeriesLifecycleFailure = {
  outcome:
    | "denied"
    | "not-found"
    | "inactive"
    | "active-operation"
    | "invalid-transition"
    | "request-already-pending"
    | "request-not-found"
    | "request-invalid-state";
};

export type SeriesLifecycleDetail = {
  operationalState: SeriesOperationalState;
  inactiveReason: SeriesInactiveReason | null;
  inactiveReasonDetail: string | null;
  stateChangedAt: Date;
  stateChangedBy: string | null;
  history: Array<{
    id: string;
    previousState: SeriesOperationalState;
    nextState: SeriesOperationalState;
    inactiveReason: SeriesInactiveReason | null;
    inactiveReasonDetail: string | null;
    actorUserId: string;
    responsibleUserIdAtEvent: string | null;
    responsibleLabelSnapshot: string | null;
    sourceReactivationRequestId: string | null;
    occurredAt: Date;
  }>;
  requests: Array<{
    id: string;
    requestedBy: string;
    requestedByLabel: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
    requestNote: string | null;
    requestedAt: Date;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    resolutionNote: string | null;
  }>;
};

export interface SeriesLifecycleMutationPort {
  deactivate(input: {
    actor: AuthorizationContext;
    seriesId: string;
    reason: SeriesInactiveReason;
    reasonDetail?: string | null | undefined;
    correlationRequestId?: string | undefined;
  }): Promise<{ outcome: "deactivated" } | SeriesLifecycleFailure>;
  reactivate(input: {
    actor: AuthorizationContext;
    seriesId: string;
    resolutionNote?: string | null | undefined;
    correlationRequestId?: string | undefined;
  }): Promise<{ outcome: "reactivated" } | SeriesLifecycleFailure>;
  requestReactivation(input: {
    actor: AuthorizationContext;
    seriesId: string;
    note?: string | null | undefined;
    correlationRequestId?: string | undefined;
  }): Promise<
    | { outcome: "requested"; reactivationRequestId: string }
    | SeriesLifecycleFailure
  >;
  approveReactivation(input: {
    actor: AuthorizationContext;
    seriesId: string;
    reactivationRequestId: string;
    correlationRequestId?: string | undefined;
    resolutionNote?: string | null | undefined;
  }): Promise<{ outcome: "approved" } | SeriesLifecycleFailure>;
  rejectReactivation(input: {
    actor: AuthorizationContext;
    seriesId: string;
    reactivationRequestId: string;
    correlationRequestId?: string | undefined;
    resolutionNote?: string | null | undefined;
  }): Promise<{ outcome: "rejected" } | SeriesLifecycleFailure>;
}

export interface SeriesLifecycleQueryPort {
  getLifecycleDetail(seriesId: string): Promise<SeriesLifecycleDetail | null>;
}
