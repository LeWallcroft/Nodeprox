import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";
import {
  series,
  seriesInactiveReasonEnum,
  seriesOperationalStateEnum,
} from "./series.js";

export const seriesOperationalHistory = pgTable(
  "series_operational_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    previousState: seriesOperationalStateEnum("previous_state").notNull(),
    nextState: seriesOperationalStateEnum("next_state").notNull(),
    inactiveReason: seriesInactiveReasonEnum("inactive_reason"),
    inactiveReasonDetail: text("inactive_reason_detail"),
    actorUserId: uuid("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    responsibleUserIdAtEvent: uuid("responsible_user_id_at_event").references(
      () => users.id,
      { onDelete: "set null" },
    ),
    responsibleLabelSnapshot: text("responsible_label_snapshot"),
    sourceRequestId: uuid("source_request_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("series_operational_history_series_occurred_idx").on(
      table.seriesId,
      table.occurredAt.desc(),
    ),
    index("series_operational_history_actor_idx").on(table.actorUserId),
  ],
);

export const seriesReactivationRequestStatusEnum = pgEnum(
  "series_reactivation_request_status",
  ["pending", "approved", "rejected", "cancelled"],
);

export const seriesReactivationRequests = pgTable(
  "series_reactivation_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: seriesReactivationRequestStatusEnum("status")
      .notNull()
      .default("pending"),
    requestNote: text("request_note"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedBy: uuid("reviewed_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
  },
  (table) => [
    check(
      "series_reactivation_review_consistent",
      sql`(${table.status} = 'pending' and ${table.reviewedBy} is null and ${table.reviewedAt} is null)
      or (${table.status} <> 'pending' and ${table.reviewedBy} is not null and ${table.reviewedAt} is not null)`,
    ),
    uniqueIndex("series_reactivation_one_pending_idx")
      .on(table.seriesId)
      .where(sql`${table.status} = 'pending'`),
    index("series_reactivation_series_idx").on(table.seriesId),
    index("series_reactivation_status_idx").on(table.status),
    index("series_reactivation_requested_idx").on(table.requestedAt),
  ],
);
