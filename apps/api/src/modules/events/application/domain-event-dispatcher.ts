import type {
  DomainEventHandler,
  DomainEventHandlerRegistry,
} from "./domain-event-handler.js";
import type {
  ClaimedDomainEventEnvelope,
  DomainEventOutboxRepository,
} from "./domain-event-outbox.repository.js";

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
  processed: number;
  failed: number;
  skipped: number;
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
      processed: 0,
      failed: 0,
      skipped: 0,
    };
    for (const event of events) {
      const handlers = this.registry.getHandlers(event.eventType);
      if (handlers.length === 0) {
        await this.outbox.defer({
          eventId: event.id,
          claimToken: event.claimToken,
          nextAttemptAt: new Date(
            now.getTime() + this.options.noHandlerDelayMs,
          ),
        });
        result.skipped += 1;
        this.logger.warn(
          this.logContext(event, { result: "no-handler" }),
          "Domain event deferred because no handler is registered",
        );
        continue;
      }
      const failure = await this.runHandlers(event, handlers);
      if (failure) {
        const attempt = event.attemptCount + 1;
        await this.outbox.recordFailure({
          eventId: event.id,
          claimToken: event.claimToken,
          attemptedAt: now,
          nextAttemptAt: new Date(now.getTime() + this.retryDelayMs(attempt)),
          errorCode: failure.errorCode,
        });
        result.failed += 1;
        this.logger.error(
          this.logContext(event, {
            handlerName: failure.handlerName,
            result: "failed",
            errorCode: failure.errorCode,
          }),
          "Domain event handler failed",
        );
        continue;
      }
      const processed = await this.outbox.markProcessed({
        eventId: event.id,
        claimToken: event.claimToken,
        processedAt: new Date(),
      });
      if (!processed) {
        result.skipped += 1;
        this.logger.warn(
          this.logContext(event, { result: "claim-lost" }),
          "Domain event claim was lost before it could be marked processed",
        );
        continue;
      }
      result.processed += 1;
      this.logger.debug(
        this.logContext(event, { result: "processed" }),
        "Domain event processed",
      );
    }
    return result;
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
