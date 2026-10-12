import type {
  DomainEventHandler,
  DomainEventHandlerRegistry,
} from "./domain-event-handler.js";
import type {
  ClaimedDomainEventEnvelope,
  DomainEventOutboxRepository,
} from "./domain-event-outbox.repository.js";
import {
  domainEventPolicyCatalog,
  type DomainEventPolicyCatalog,
} from "./domain-event-policy.js";

export interface DomainEventDispatchLogger {
  debug(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
}

export interface DomainEventDispatcherOptions {
  batchSize: number;
  leaseDurationMs: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  noHandlerDelayMs: number;
}

export interface DomainEventDispatchResult {
  claimed: number;
  dispatched: number;
  terminal: number;
  failed: number;
  deferred: number;
  claimLost: number;
}

const defaultOptions: DomainEventDispatcherOptions = {
  batchSize: 20,
  leaseDurationMs: 30_000,
  retryBaseDelayMs: 1_000,
  retryMaxDelayMs: 60_000,
  noHandlerDelayMs: 300_000,
};

export class DomainEventDispatcher {
  private readonly options: DomainEventDispatcherOptions;

  constructor(
    private readonly outbox: DomainEventOutboxRepository,
    private readonly registry: DomainEventHandlerRegistry,
    private readonly logger: DomainEventDispatchLogger,
    options: Partial<DomainEventDispatcherOptions> = {},
    private readonly policy: DomainEventPolicyCatalog = domainEventPolicyCatalog,
  ) {
    this.options = { ...defaultOptions, ...options };
  }

  async runOnce(
    input: { batchSize?: number } = {},
  ): Promise<DomainEventDispatchResult> {
    const now = new Date();
    const events = await this.outbox.claimPending({
      limit: input.batchSize ?? this.options.batchSize,
      now,
      leaseDurationMs: this.options.leaseDurationMs,
    });
    const result: DomainEventDispatchResult = {
      claimed: events.length,
      dispatched: 0,
      terminal: 0,
      failed: 0,
      deferred: 0,
      claimLost: 0,
    };
    for (const event of events) {
      const disposition = this.policy.getDisposition(event.eventType);
      const handlers = this.registry.getHandlers(event.eventType);
      if (
        disposition === null ||
        (disposition === "dispatch-required" && handlers.length === 0) ||
        (disposition === "terminal-legacy" && handlers.length > 0)
      ) {
        const reason =
          disposition === null
            ? "unclassified-event-type"
            : disposition === "terminal-legacy"
              ? "terminal-handler-conflict"
              : "missing-required-handler";
        const deferred = await this.outbox.defer({
          eventId: event.id,
          claimToken: event.claimToken,
          nextAttemptAt: new Date(
            now.getTime() + this.options.noHandlerDelayMs,
          ),
        });
        if (!deferred) this.claimLost(result, event);
        else {
          result.deferred += 1;
          const context = this.logContext(event, { result: reason });
          if (reason === "terminal-handler-conflict")
            this.logger.error(
              context,
              "Domain event policy conflicts with registered handler",
            );
          else this.logger.warn(context, "Domain event deferred by policy");
        }
        continue;
      }
      if (disposition === "terminal-legacy") {
        const completed = await this.outbox.complete({
          eventId: event.id,
          claimToken: event.claimToken,
          completedAt: new Date(),
          completionKind: "terminal-no-handler",
        });
        if (!completed) this.claimLost(result, event);
        else {
          result.terminal += 1;
          this.logger.debug(
            this.logContext(event, { result: "terminal-no-handler" }),
            "Legacy domain event completed without handler",
          );
        }
        continue;
      }
      const failure = await this.runHandlers(event, handlers);
      if (failure) {
        const attempt = event.attemptCount + 1;
        const recorded = await this.outbox.recordFailure({
          eventId: event.id,
          claimToken: event.claimToken,
          attemptedAt: now,
          nextAttemptAt: new Date(now.getTime() + this.retryDelayMs(attempt)),
          errorCode: failure.errorCode,
        });
        if (!recorded) this.claimLost(result, event);
        else {
          result.failed += 1;
          this.logger.error(
            this.logContext(event, {
              handlerName: failure.handlerName,
              result: "handler-failed",
              errorCode: failure.errorCode,
            }),
            "Domain event handler failed",
          );
        }
        continue;
      }
      const completed = await this.outbox.complete({
        eventId: event.id,
        claimToken: event.claimToken,
        completedAt: new Date(),
        completionKind: "dispatched",
      });
      if (!completed) {
        this.claimLost(result, event);
        continue;
      }
      result.dispatched += 1;
      this.logger.debug(
        this.logContext(event, { result: "dispatched" }),
        "Domain event dispatched",
      );
    }
    return result;
  }

  private claimLost(
    result: DomainEventDispatchResult,
    event: ClaimedDomainEventEnvelope,
  ): void {
    result.claimLost += 1;
    this.logger.warn(
      this.logContext(event, { result: "claim-lost" }),
      "Domain event claim was lost before transition persisted",
    );
  }

  private async runHandlers(
    event: ClaimedDomainEventEnvelope,
    handlers: readonly DomainEventHandler[],
  ): Promise<{ handlerName: string; errorCode: string } | null> {
    for (const handler of handlers) {
      try {
        await handler.handle(event);
        this.logger.debug(
          this.logContext(event, {
            handlerName: handler.handlerName,
            result: "handled",
          }),
          "Domain event handler completed",
        );
      } catch (error) {
        return {
          handlerName: handler.handlerName,
          errorCode: errorCode(error),
        };
      }
    }
    return null;
  }

  private retryDelayMs(attempt: number): number {
    const multiplier = 2 ** Math.max(0, attempt - 1);
    return Math.min(
      this.options.retryBaseDelayMs * multiplier,
      this.options.retryMaxDelayMs,
    );
  }

  private logContext(
    event: ClaimedDomainEventEnvelope,
    extra: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      eventId: event.id,
      eventType: event.eventType,
      aggregateType: event.aggregateType,
      aggregateId: event.aggregateId,
      originRequestId: event.originRequestId,
      attemptCount: event.attemptCount,
      ...extra,
    };
  }
}

function errorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z0-9._-]{1,64}$/i.test(error.code)
  )
    return error.code;
  if (error instanceof Error && /^[A-Za-z0-9_-]{1,64}$/.test(error.name))
    return error.name;
  return "handler-failed";
}
