import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterEach, describe, expect, inject, it } from "vitest";
import { DrizzleDomainEventOutboxRepository } from "../../apps/api/src/modules/events/infrastructure/persistence/drizzle-domain-event-outbox.repository.js";
import { DomainEventDispatcher } from "../../apps/api/src/modules/events/application/domain-event-dispatcher.js";
import { DefaultDomainEventHandlerRegistry } from "../../apps/api/src/modules/events/application/domain-event-handler.js";
import { createDatabase } from "../../database/client.js";
import { domainEventOutbox } from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const first = new DrizzleDomainEventOutboxRepository(database.db);
const second = new DrizzleDomainEventOutboxRepository(database.db);
const insertedIds: string[] = [];

async function insertEvent(input: {
  occurredAt: Date;
  processedAt?: Date;
  eventType?: string;
}) {
  const id = randomUUID();
  insertedIds.push(id);
  await database.db.insert(domainEventOutbox).values({
    id,
    eventType: input.eventType ?? "series.creation_grant.issued",
    aggregateType: "series_creation_grant",
    aggregateId: randomUUID(),
    payload: { targetUserId: randomUUID() },
    occurredAt: input.occurredAt,
    ...(input.processedAt ? { processedAt: input.processedAt } : {}),
  });
  return id;
}

afterEach(async () => {
  if (insertedIds.length > 0) {
    await database.db
      .delete(domainEventOutbox)
      .where(inArray(domainEventOutbox.id, insertedIds.splice(0)));
  }
});

describe("Domain event outbox leases", () => {
  const logger = { debug() {}, warn() {}, error() {} };

  it("persists dispatched completion and protects the claim token", async () => {
    const id = await insertEvent({ occurredAt: new Date(0) });
    const dispatcher = new DomainEventDispatcher(
      first,
      new DefaultDomainEventHandlerRegistry([
        {
          handlerName: "fixture",
          eventTypes: ["series.creation_grant.issued"],
          async handle() {},
        },
      ]),
      logger,
    );
    expect((await dispatcher.runOnce()).dispatched).toBeGreaterThanOrEqual(1);
    const [row] = await database.db
      .select()
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.id, id));
    expect(row?.completionKind).toBe("dispatched");
    expect(row?.processedAt).toBeInstanceOf(Date);
    expect(
      await first.complete({
        eventId: id,
        claimToken: "wrong",
        completedAt: new Date(),
        completionKind: "dispatched",
      }),
    ).toBe(false);
  });

  it.each([
    "series.responsibility.assigned",
    "series.responsibility.reassigned",
    "series.channel.bound",
    "series.creation_grant.consumed",
    "series.creation_grant.invalidated",
    "discord.identity.linked",
  ])(
    "drains legacy event %s by normal claim without handler execution",
    async (eventType) => {
      const id = await insertEvent({ occurredAt: new Date(0), eventType });
      const dispatcher = new DomainEventDispatcher(
        first,
        new DefaultDomainEventHandlerRegistry([]),
        logger,
      );
      expect((await dispatcher.runOnce()).terminal).toBe(1);
      const [row] = await database.db
        .select()
        .from(domainEventOutbox)
        .where(eq(domainEventOutbox.id, id));
      expect(row?.completionKind).toBe("terminal-no-handler");
      expect(row?.attemptCount).toBe(0);
      const reclaimed = await first.claimPending({
        now: new Date(),
        limit: 100,
        leaseDurationMs: 30_000,
      });
      expect(reclaimed.some((event) => event.id === id)).toBe(false);
    },
  );

  it.each(["unknown.event", "series.creation_grant.issued"])(
    "defers unhandled or unknown %s without incrementing attempts",
    async (eventType) => {
      const id = await insertEvent({ occurredAt: new Date(0), eventType });
      const result = await new DomainEventDispatcher(
        first,
        new DefaultDomainEventHandlerRegistry([]),
        logger,
      ).runOnce();
      expect(result.deferred).toBe(1);
      const [row] = await database.db
        .select()
        .from(domainEventOutbox)
        .where(eq(domainEventOutbox.id, id));
      expect(row?.processedAt).toBeNull();
      expect(row?.completionKind).toBeNull();
      expect(row?.attemptCount).toBe(0);
    },
  );
  it("claims pending events deterministically and never claims processed events", async () => {
    const now = new Date("2026-09-15T00:00:00.000Z");
    const oldest = await insertEvent({
      occurredAt: new Date("2026-09-14T00:00:00.000Z"),
    });
    await insertEvent({ occurredAt: new Date("2026-09-14T00:01:00.000Z") });
    await insertEvent({
      occurredAt: new Date("2026-09-13T00:00:00.000Z"),
      processedAt: new Date("2026-09-13T00:02:00.000Z"),
    });

    const claimed = await first.claimPending({
      now,
      limit: 1,
      leaseDurationMs: 30_000,
    });

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.id).toBe(oldest);
  });

  it("does not allow concurrent dispatchers to claim the same event", async () => {
    const eventId = await insertEvent({ occurredAt: new Date(0) });
    const now = new Date();

    const [left, right] = await Promise.all([
      first.claimPending({ now, limit: 10, leaseDurationMs: 30_000 }),
      second.claimPending({ now, limit: 10, leaseDurationMs: 30_000 }),
    ]);

    expect(
      [...left, ...right].filter((event) => event.id === eventId),
    ).toHaveLength(1);
  });

  it("does not reclaim active leases but recovers expired leases", async () => {
    await insertEvent({ occurredAt: new Date(0) });
    const now = new Date("2026-09-15T00:00:00.000Z");
    const [claimed] = await first.claimPending({
      now,
      limit: 1,
      leaseDurationMs: 30_000,
    });
    expect(claimed).toBeDefined();

    const duringLease = await second.claimPending({
      now: new Date(now.getTime() + 1_000),
      limit: 1,
      leaseDurationMs: 30_000,
    });
    expect(duringLease.some((event) => event.id === claimed?.id)).toBe(false);
    const afterExpiry = await second.claimPending({
      now: new Date(now.getTime() + 30_001),
      limit: 1,
      leaseDurationMs: 30_000,
    });
    expect(afterExpiry.some((event) => event.id === claimed?.id)).toBe(true);
  });

  it("increments attempts and releases a failed claim for a later retry", async () => {
    const eventId = await insertEvent({ occurredAt: new Date(0) });
    const [claimed] = await first.claimPending({
      now: new Date(),
      limit: 1,
      leaseDurationMs: 30_000,
    });
    if (!claimed) throw new Error("Expected claimed event");

    await expect(
      first.recordFailure({
        eventId,
        claimToken: claimed.claimToken,
        attemptedAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 10_000),
        errorCode: "handler-failed",
      }),
    ).resolves.toBe(true);
    const [stored] = await database.db
      .select({
        attemptCount: domainEventOutbox.attemptCount,
        processedAt: domainEventOutbox.processedAt,
        claimToken: domainEventOutbox.claimToken,
      })
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.id, eventId));
    expect(stored).toEqual({
      attemptCount: 1,
      processedAt: null,
      claimToken: null,
    });
  });

  it("reads existing Discord and Series event envelopes without interpreting payloads", async () => {
    const eventTypes = [
      "series.creation_grant.issued",
      "series.creation_grant.consumed",
      "discord.identity.linked",
    ];
    const ids: string[] = await Promise.all(
      eventTypes.map(async (eventType, index) => {
        const id = randomUUID();
        insertedIds.push(id);
        await database.db.insert(domainEventOutbox).values({
          id,
          eventType,
          aggregateType: "fixture",
          aggregateId: randomUUID(),
          payload: { fixture: true },
          occurredAt: new Date(index),
        });
        return id;
      }),
    );

    const claimed = await first.claimPending({
      now: new Date("2026-09-15T00:00:00.000Z"),
      limit: 10,
      leaseDurationMs: 30_000,
    });

    const fixtureEvents = claimed.filter((event) => ids.includes(event.id));
    expect(fixtureEvents.map((event) => event.id)).toEqual(ids);
    expect(fixtureEvents.map((event) => event.eventType)).toEqual(eventTypes);
  });
});
