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
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";

export const seriesOperationalStateEnum = pgEnum("series_operational_state", [
  "active",
  "inactive",
]);

export const seriesInactiveReasonEnum = pgEnum("series_inactive_reason", [
  "dropped",
  "hiatus",
  "completed",
  "other",
]);

export const series = pgTable(
  "series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: varchar("title", { length: 200 }).notNull(),
    slug: varchar("slug", { length: 220 }).notNull(),
    description: text("description"),
    coverUrl: varchar("cover_url", { length: 2048 }),
    discordChannelId: text("discord_channel_id"),
    discordChannelNameSnapshot: text("discord_channel_name_snapshot"),
    operationalState: seriesOperationalStateEnum("operational_state")
      .notNull()
      .default("active"),
    inactiveReason: seriesInactiveReasonEnum("inactive_reason"),
    inactiveReasonDetail: text("inactive_reason_detail"),
    stateChangedAt: timestamp("state_changed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    stateChangedBy: uuid("state_changed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "series_operational_state_consistent",
      sql`(${table.operationalState} = 'active' and ${table.inactiveReason} is null and ${table.inactiveReasonDetail} is null)
        or (${table.operationalState} = 'inactive' and ${table.inactiveReason} is not null and
          (${table.inactiveReason} <> 'other' or nullif(btrim(${table.inactiveReasonDetail}), '') is not null))`,
    ),
    uniqueIndex("series_slug_unique").on(table.slug),
    uniqueIndex("series_discord_channel_id_unique")
      .on(table.discordChannelId)
      .where(sql`${table.discordChannelId} IS NOT NULL`),
    index("series_created_by_idx").on(table.createdBy),
  ],
);

export const seriesAssignments = pgTable(
  "series_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    responsibleUserId: uuid("responsible_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    assignedBy: uuid("assigned_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("series_assignments_series_unique").on(table.seriesId),
    index("series_assignments_responsible_user_idx").on(
      table.responsibleUserId,
    ),
  ],
);
