import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { storageProfiles } from "./storage-profiles.js";

export const mediaEffectTypeEnum = pgEnum("media_effect_type", [
  "cdn_purge",
  "storage_delete",
]);

export const mediaEffectStatusEnum = pgEnum("media_effect_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const mediaEffectOutbox = pgTable(
  "media_effect_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    replacementOperationId: uuid("replacement_operation_id").notNull(),
    effectType: mediaEffectTypeEnum("effect_type").notNull(),
    imageId: uuid("image_id").notNull(),
    target: text("target").notNull(),
    storageProfileId: uuid("storage_profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "restrict" }),
    status: mediaEffectStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastErrorCode: text("last_error_code"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("media_effect_outbox_operation_effect_target_unique").on(
      table.replacementOperationId,
      table.effectType,
      table.target,
    ),
    index("media_effect_outbox_pending_idx").on(
      table.status,
      table.availableAt,
    ),
    index("media_effect_outbox_image_idx").on(table.imageId),
    index("media_effect_outbox_profile_idx").on(table.storageProfileId),
  ],
);
