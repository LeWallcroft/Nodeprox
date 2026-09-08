import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";
import { series } from "./series.js";

export const seriesCreationGrantStatusEnum = pgEnum(
  "series_creation_grant_status",
  ["available", "reserved", "consumed", "invalidated"],
);

export const seriesCreationGrants = pgTable(
  "series_creation_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayCode: text("display_code").notNull(),
    targetUserId: uuid("target_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    reference: text("reference"),
    status: seriesCreationGrantStatusEnum("status")
      .notNull()
      .default("available"),
    issuedByDiscordId: text("issued_by_discord_id").notNull(),
    issuedFromChannelId: text("issued_from_channel_id").notNull(),
    issuedInteractionId: text("issued_interaction_id").notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }),
    reservedUntil: timestamp("reserved_until", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    consumedBySeriesId: uuid("consumed_by_series_id").references(
      () => series.id,
      { onDelete: "restrict" },
    ),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    invalidatedByDiscordId: text("invalidated_by_discord_id"),
    invalidatedInteractionId: text("invalidated_interaction_id"),
  },
  (table) => [
    uniqueIndex("series_creation_grants_display_code_unique").on(
      table.displayCode,
    ),
    uniqueIndex("series_creation_grants_issued_interaction_unique").on(
      table.issuedInteractionId,
    ),
    uniqueIndex("series_creation_grants_consumed_by_series_unique").on(
      table.consumedBySeriesId,
    ),
    index("series_creation_grants_target_status_idx").on(
      table.targetUserId,
      table.status,
    ),
    index("series_creation_grants_status_issued_at_idx").on(
      table.status,
      table.issuedAt,
    ),
    index("series_creation_grants_issued_by_discord_id_idx").on(
      table.issuedByDiscordId,
    ),
  ],
);
