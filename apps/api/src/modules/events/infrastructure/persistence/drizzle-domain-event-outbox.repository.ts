import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import { domainEventOutbox } from "../../../../../../../database/schema/index.js";
import type {
  ClaimedDomainEventEnvelope,
  DomainEventOutboxRepository,
} from "../../application/domain-event-outbox.repository.js";

export class DrizzleDomainEventOutboxRepository
  implements DomainEventOutboxRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async claimPending(input: {
    limit: number;
    now: Date;
    leaseDurationMs: number;
  }): Promise<ClaimedDomainEventEnvelope[]> {
    const claimToken = randomUUID();
    const lockedUntil = new Date(input.now.getTime() + input.leaseDurationMs);
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: domainEventOutbox.id,
          eventType: domainEventOutbox.eventType,
          aggregateType: domainEventOutbox.aggregateType,
          aggregateId: domainEventOutbox.aggregateId,
          actorUserId: domainEventOutbox.actorUserId,
          payload: domainEventOutbox.payload,
          occurredAt: domainEventOutbox.occurredAt,
          attemptCount: domainEventOutbox.attemptCount,
        })
        .from(domainEventOutbox)
        .where(
          and(
            isNull(domainEventOutbox.processedAt),
            or(
              isNull(domainEventOutbox.nextAttemptAt),
              lte(domainEventOutbox.nextAttemptAt, input.now),
            ),
            or(
              isNull(domainEventOutbox.lockedUntil),
              lt(domainEventOutbox.lockedUntil, input.now),
            ),
          ),
        )
        .orderBy(asc(domainEventOutbox.occurredAt), asc(domainEventOutbox.id))
        .limit(input.limit)
        .for("update", { skipLocked: true });
      if (rows.length === 0) return [];
      await tx
        .update(domainEventOutbox)
        .set({
          claimToken,
          claimedAt: input.now,
          lockedUntil,
        })
        .where(
          inArray(
            domainEventOutbox.id,
            rows.map((row) => row.id),
          ),
        );
      return rows.map((row) => ({ ...row, claimToken }));
    });
  }

  async markProcessed(input: {
    eventId: string;
    claimToken: string;
    processedAt: Date;
  }): Promise<boolean> {
    const [updated] = await this.db
      .update(domainEventOutbox)
      .set({
        processedAt: input.processedAt,
        claimToken: null,
        claimedAt: null,
        lockedUntil: null,
        nextAttemptAt: null,
        lastErrorCode: null,
      })
      .where(
        and(
          eq(domainEventOutbox.id, input.eventId),
          eq(domainEventOutbox.claimToken, input.claimToken),
          isNull(domainEventOutbox.processedAt),
        ),
      )
      .returning({ id: domainEventOutbox.id });
    return updated !== undefined;
  }

  async recordFailure(input: {
    eventId: string;
    claimToken: string;
    attemptedAt: Date;
    nextAttemptAt: Date;
    errorCode: string;
  }): Promise<boolean> {
    const [updated] = await this.db
      .update(domainEventOutbox)
      .set({
        attemptCount: sql`${domainEventOutbox.attemptCount} + 1`,
        lastAttemptAt: input.attemptedAt,
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: input.errorCode,
        claimToken: null,
        claimedAt: null,
        lockedUntil: null,
      })
      .where(
        and(
          eq(domainEventOutbox.id, input.eventId),
          eq(domainEventOutbox.claimToken, input.claimToken),
          isNull(domainEventOutbox.processedAt),
        ),
      )
      .returning({ id: domainEventOutbox.id });
    return updated !== undefined;
  }

  async defer(input: {
    eventId: string;
    claimToken: string;
    nextAttemptAt: Date;
  }): Promise<boolean> {
    const [updated] = await this.db
      .update(domainEventOutbox)
      .set({
        nextAttemptAt: input.nextAttemptAt,
        claimToken: null,
        claimedAt: null,
        lockedUntil: null,
      })
      .where(
        and(
          eq(domainEventOutbox.id, input.eventId),
          eq(domainEventOutbox.claimToken, input.claimToken),
          isNull(domainEventOutbox.processedAt),
        ),
      )
      .returning({ id: domainEventOutbox.id });
    return updated !== undefined;
  }
}
