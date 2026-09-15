import type { DomainEventEnvelope } from "./domain-event-handler.js";

export interface ClaimedDomainEventEnvelope extends DomainEventEnvelope {
  claimToken: string;
}

export interface DomainEventOutboxRepository {
  claimPending(input: {
    limit: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<ClaimedDomainEventEnvelope[]>;

  markProcessed(input: {
    eventId: string;
    claimToken: string;
    processedAt: Date;
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
