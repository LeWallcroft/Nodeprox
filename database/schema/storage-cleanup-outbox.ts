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
import { chapterReplacementOperations } from "./chapter-replacement-operations.js";

export const storageCleanupReasonEnum = pgEnum("storage_cleanup_reason", [
  "replacement_source_zip",
  "replacement_failed_candidate",
]);

export const storageCleanupStatusEnum = pgEnum("storage_cleanup_status", [
  "pending",
  "processing",
  "completed",
  "failed",
]);

export const storageCleanupOutbox = pgTable(
  "storage_cleanup_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    replacementId: uuid("replacement_id")
      .notNull()
      .references(() => chapterReplacementOperations.id, {
        onDelete: "cascade",
      }),
    storageKey: text("storage_key").notNull(),
    reason: storageCleanupReasonEnum("reason").notNull(),
    status: storageCleanupStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastErrorCode: text("last_error_code"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("storage_cleanup_outbox_replacement_reason_key_unique").on(
      table.replacementId,
      table.reason,
      table.storageKey,
    ),
    index("storage_cleanup_outbox_pending_idx").on(
      table.status,
      table.availableAt,
    ),
    index("storage_cleanup_outbox_replacement_idx").on(table.replacementId),
  ],
);
