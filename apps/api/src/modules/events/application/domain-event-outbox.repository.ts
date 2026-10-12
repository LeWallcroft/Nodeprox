import type { DomainEventEnvelope } from "./domain-event-handler.js";

export interface ClaimedDomainEventEnvelope extends DomainEventEnvelope {
  claimToken: string;
}

export type DomainEventCompletionKind = "dispatched" | "terminal-no-handler";

export interface DomainEventOutboxRepository {
  claimPending(input: {
    limit: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<ClaimedDomainEventEnvelope[]>;

  complete(input: {
    eventId: string;
    claimToken: string;
    completedAt: Date;
    completionKind: DomainEventCompletionKind;
  }): Promise<boolean>;

  recordFailure(input: {
    eventId: string;
    claimToken: string;
    attemptedAt: Date;
    nextAttemptAt: Date;
    errorCode: string;
  }): Promise<boolean>;

  defer(input: {
    eventId: string;
    claimToken: string;
    nextAttemptAt: Date;
  }): Promise<boolean>;
}
