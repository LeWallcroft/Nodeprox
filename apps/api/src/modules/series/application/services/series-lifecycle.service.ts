import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { SeriesInactiveReason } from "../../domain/series-lifecycle.types.js";
import type {
  SeriesLifecycleMutationPort,
  SeriesLifecycleQueryPort,
} from "../ports/series-lifecycle.ports.js";
import type { SeriesService } from "./series.service.js";

export class SeriesLifecycleService {
  constructor(
    private readonly mutations: SeriesLifecycleMutationPort,
    private readonly queries: SeriesLifecycleQueryPort,
    private readonly series: SeriesService,
  ) {}

  deactivate(
    context: AuthorizationContext,
    input: {
      seriesId: string;
      reason: SeriesInactiveReason;
      reasonDetail?: string | null | undefined;
      correlationRequestId?: string | undefined;
    },
  ) {
    return this.mutations.deactivate({ actor: context, ...input });
  }

  reactivate(
    context: AuthorizationContext,
    input: {
      seriesId: string;
      resolutionNote?: string | null | undefined;
      correlationRequestId?: string | undefined;
    },
  ) {
    return this.mutations.reactivate({ actor: context, ...input });
  }

  requestReactivation(
    context: AuthorizationContext,
    input: {
      seriesId: string;
      note?: string | null | undefined;
      correlationRequestId?: string | undefined;
    },
  ) {
    return this.mutations.requestReactivation({ actor: context, ...input });
  }

  approveReactivation(
    context: AuthorizationContext,
    input: {
      seriesId: string;
      reactivationRequestId: string;
      correlationRequestId?: string | undefined;
      resolutionNote?: string | null | undefined;
    },
  ) {
    return this.mutations.approveReactivation({ actor: context, ...input });
  }

  rejectReactivation(
    context: AuthorizationContext,
    input: {
      seriesId: string;
      reactivationRequestId: string;
      correlationRequestId?: string | undefined;
      resolutionNote?: string | null | undefined;
    },
  ) {
    return this.mutations.rejectReactivation({ actor: context, ...input });
  }

  async getDetail(context: AuthorizationContext, seriesId: string) {
    const visible = await this.series.get(context, seriesId);
    if (!visible || "forbidden" in visible) return visible;
    return this.queries.getLifecycleDetail(seriesId);
  }
}
