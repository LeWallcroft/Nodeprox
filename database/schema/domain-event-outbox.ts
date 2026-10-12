import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";

export const domainEventOutbox = pgTable(
  "domain_event_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventType: text("event_type").notNull(),
    aggregateType: text("aggregate_type").notNull(),
    aggregateId: text("aggregate_id").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    originRequestId: text("origin_request_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    claimToken: text("claim_token"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
  },
  (table) => [
    index("domain_event_outbox_pending_idx").on(
      table.processedAt,
      table.occurredAt,
    ),
    index("domain_event_outbox_aggregate_idx").on(
      table.aggregateType,
      table.aggregateId,
    ),
    index("domain_event_outbox_origin_request_idx").on(table.originRequestId),
    index("domain_event_outbox_claimable_idx").on(
      table.processedAt,
      table.nextAttemptAt,
      table.lockedUntil,
      table.occurredAt,
    ),
  ],
);
