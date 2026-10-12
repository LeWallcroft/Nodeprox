import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  DomainEventDispatcher,
  type DomainEventDispatchLogger,
} from "../../apps/api/src/modules/events/application/domain-event-dispatcher.js";
import {
  DefaultDomainEventHandlerRegistry,
  type DomainEventEnvelope,
  type DomainEventHandler,
} from "../../apps/api/src/modules/events/application/domain-event-handler.js";
import type {
  ClaimedDomainEventEnvelope,
  DomainEventOutboxRepository,
  DomainEventCompletionKind,
} from "../../apps/api/src/modules/events/application/domain-event-outbox.repository.js";

type StoredEvent = DomainEventEnvelope & {
  processedAt?: Date;
  completionKind?: DomainEventCompletionKind;
  claimToken?: string;
  lockedUntil?: Date;
  nextAttemptAt?: Date;
};

class MemoryOutbox implements DomainEventOutboxRepository {
  readonly events: StoredEvent[];

  constructor(events: StoredEvent[]) {
    this.events = events;
  }

  async claimPending(input: {
    limit: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<ClaimedDomainEventEnvelope[]> {
    return this.events
      .filter(
        (event) =>
          !event.processedAt &&
          (!event.nextAttemptAt || event.nextAttemptAt <= input.now) &&
          (!event.lockedUntil || event.lockedUntil < input.now),
      )
      .sort(
        (left, right) =>
          left.occurredAt.getTime() - right.occurredAt.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, input.limit)
      .map((event) => {
        const claimToken = randomUUID();
        event.claimToken = claimToken;
        event.lockedUntil = new Date(
          input.now.getTime() + input.leaseDurationMs,
        );
        return { ...event, claimToken };
      });
  }

  async complete(input: {
    eventId: string;
    claimToken: string;
    completedAt: Date;
    completionKind: DomainEventCompletionKind;
  }): Promise<boolean> {
    const event = this.findClaimed(input.eventId, input.claimToken);
    if (!event) return false;
    event.processedAt = input.completedAt;
    event.completionKind = input.completionKind;
    delete event.claimToken;
    delete event.lockedUntil;
    delete event.nextAttemptAt;
    return true;
  }

  async recordFailure(input: {
    eventId: string;
    claimToken: string;
    attemptedAt: Date;
    nextAttemptAt: Date;
    errorCode: string;
  }): Promise<boolean> {
    const event = this.findClaimed(input.eventId, input.claimToken);
    if (!event) return false;
    event.attemptCount += 1;
    event.nextAttemptAt = input.nextAttemptAt;
    delete event.claimToken;
    delete event.lockedUntil;
    return true;
  }

  async defer(input: {
    eventId: string;
    claimToken: string;
    nextAttemptAt: Date;
  }): Promise<boolean> {
    const event = this.findClaimed(input.eventId, input.claimToken);
    if (!event) return false;
    event.nextAttemptAt = input.nextAttemptAt;
    delete event.claimToken;
    delete event.lockedUntil;
    return true;
  }

  private findClaimed(eventId: string, claimToken: string) {
    const event = this.events.find((candidate) => candidate.id === eventId);
    return event?.claimToken === claimToken ? event : undefined;
  }
}

const logger: DomainEventDispatchLogger = {
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

function event(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: randomUUID(),
    eventType: "series.creation_grant.issued",
    aggregateType: "series_creation_grant",
    aggregateId: randomUUID(),
    actorUserId: null,
    originRequestId: null,
    payload: { targetUserId: randomUUID() },
    occurredAt: new Date("2026-09-14T00:00:00.000Z"),
    attemptCount: 0,
    ...overrides,
  };
}

function handler(input: {
  name: string;
  eventTypes?: readonly string[];
  handle?: () => Promise<void>;
}): DomainEventHandler {
  return {
    handlerName: input.name,
    eventTypes: input.eventTypes ?? ["series.creation_grant.issued"],
    handle: async () => input.handle?.(),
  };
}

describe("DomainEventDispatcher", () => {
  it("runs registered handlers and only marks an event processed after all succeed", async () => {
    const stored = event({ originRequestId: "http-request-123" });
    const outbox = new MemoryOutbox([stored]);
    const first = handler({ name: "first" });
    const second = handler({ name: "second" });
    const dispatcher = new DomainEventDispatcher(
      outbox,
      new DefaultDomainEventHandlerRegistry([first, second]),
      logger,
    );

    await expect(dispatcher.runOnce()).resolves.toEqual({
      claimed: 1,
      dispatched: 1,
      terminal: 0,
      failed: 0,
      deferred: 0,
      claimLost: 0,
    });
    expect(outbox.events[0]?.processedAt).toBeInstanceOf(Date);
    expect(outbox.events[0]?.completionKind).toBe("dispatched");
    expect(logger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: stored.id,
        aggregateType: stored.aggregateType,
        aggregateId: stored.aggregateId,
        originRequestId: "http-request-123",
        attemptCount: 0,
      }),
      expect.any(String),
    );
  });

  it("keeps failures retryable and increments attempt count", async () => {
    const outbox = new MemoryOutbox([event()]);
    const failing = handler({
      name: "failing",
      handle: async () => {
        throw Object.assign(new Error("temporary"), { code: "temporary" });
      },
    });
    const dispatcher = new DomainEventDispatcher(
      outbox,
      new DefaultDomainEventHandlerRegistry([failing]),
      logger,
    );

    await expect(dispatcher.runOnce()).resolves.toEqual({
      claimed: 1,
      dispatched: 0,
      terminal: 0,
      failed: 1,
      deferred: 0,
      claimLost: 0,
    });
    expect(outbox.events[0]?.attemptCount).toBe(1);
    expect(outbox.events[0]?.processedAt).toBeUndefined();
  });

  it("retries a failed event and processes it after its handler recovers", async () => {
    const stored = event();
    const outbox = new MemoryOutbox([stored]);
    let failed = true;
    const dispatcher = new DomainEventDispatcher(
      outbox,
      new DefaultDomainEventHandlerRegistry([
        handler({
          name: "flaky",
          handle: async () => {
            if (failed) throw new Error("temporary");
          },
        }),
      ]),
      logger,
      { retryBaseDelayMs: 1, retryMaxDelayMs: 1 },
    );

    await dispatcher.runOnce();
    failed = false;
    stored.nextAttemptAt = new Date(0);
    await expect(dispatcher.runOnce()).resolves.toEqual({
      claimed: 1,
      dispatched: 1,
      terminal: 0,
      failed: 0,
      deferred: 0,
      claimLost: 0,
    });
    expect(stored.processedAt).toBeInstanceOf(Date);
  });

  it("defers unknown event types without marking them processed", async () => {
    const stored = event({ eventType: "unknown.event" });
    const outbox = new MemoryOutbox([stored]);
    const dispatcher = new DomainEventDispatcher(
      outbox,
      new DefaultDomainEventHandlerRegistry([]),
      logger,
    );

    await expect(dispatcher.runOnce()).resolves.toEqual({
      claimed: 1,
      dispatched: 0,
      terminal: 0,
      failed: 0,
      deferred: 1,
      claimLost: 0,
    });
    expect(stored.processedAt).toBeUndefined();
    expect(stored.attemptCount).toBe(0);
    expect(stored.nextAttemptAt).toBeInstanceOf(Date);
  });

  it("drains legacy events without handlers or an attempt increment", async () => {
    const stored = event({ eventType: "discord.identity.linked" });
    const outbox = new MemoryOutbox([stored]);
    const dispatcher = new DomainEventDispatcher(
      outbox,
      new DefaultDomainEventHandlerRegistry([]),
      logger,
    );
    expect(await dispatcher.runOnce()).toEqual({
      claimed: 1,
      dispatched: 0,
      terminal: 1,
      failed: 0,
      deferred: 0,
      claimLost: 0,
    });
    expect(stored.completionKind).toBe("terminal-no-handler");
    expect(stored.attemptCount).toBe(0);
    expect((await dispatcher.runOnce()).claimed).toBe(0);
  });

  it("defers a required event with no handler", async () => {
    const stored = event();
    const outbox = new MemoryOutbox([stored]);
    const result = await new DomainEventDispatcher(
      outbox,
      new DefaultDomainEventHandlerRegistry([]),
      logger,
    ).runOnce();
    expect(result.deferred).toBe(1);
    expect(stored.processedAt).toBeUndefined();
    expect(stored.attemptCount).toBe(0);
  });

  it("does not run a handler for terminal legacy events", async () => {
    const stored = event({ eventType: "discord.identity.linked" });
    const handle = vi.fn();
    const result = await new DomainEventDispatcher(
      new MemoryOutbox([stored]),
      new DefaultDomainEventHandlerRegistry([
        handler({
          name: "conflict",
          eventTypes: ["discord.identity.linked"],
          handle,
        }),
      ]),
      logger,
    ).runOnce();
    expect(result.deferred).toBe(1);
    expect(handle).not.toHaveBeenCalled();
    expect(stored.processedAt).toBeUndefined();
  });

  it.each(["complete", "defer", "recordFailure"] as const)(
    "counts a lost claim from %s without claiming the transition persisted",
    async (transition) => {
      const stored = event({
        eventType:
          transition === "complete"
            ? "discord.identity.linked"
            : transition === "defer"
              ? "unknown.event"
              : "series.creation_grant.issued",
      });
      const outbox = new MemoryOutbox([stored]);
      vi.spyOn(outbox, transition).mockResolvedValue(false);
      const failing = handler({
        name: "failure",
        handle: async () => {
          throw new Error("failure");
        },
      });
      const result = await new DomainEventDispatcher(
        outbox,
        new DefaultDomainEventHandlerRegistry(
          transition === "recordFailure" ? [failing] : [],
        ),
        logger,
      ).runOnce();
      expect(result.claimLost).toBe(1);
      expect(
        result.dispatched + result.terminal + result.deferred + result.failed,
      ).toBe(0);
    },
  );

  it("only resolves handlers registered for the event type", () => {
    const selected = handler({ name: "selected" });
    const unrelated = handler({
      name: "unrelated",
      eventTypes: ["discord.identity.linked"],
    });
    const registry = new DefaultDomainEventHandlerRegistry([
      selected,
      unrelated,
    ]);

    expect(registry.getHandlers("series.creation_grant.issued")).toEqual([
      selected,
    ]);
  });
});
