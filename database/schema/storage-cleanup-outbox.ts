import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { chapterReplacementOperations } from "./chapter-replacement-operations.js";
import { storageProfiles } from "./storage-profiles.js";
import { uploads } from "./uploads.js";

export const storageCleanupReasonEnum = pgEnum("storage_cleanup_reason", [
  "replacement_source_zip",
  "replacement_failed_candidate",
  "chapter_source_zip",
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
    replacementId: uuid("replacement_id").references(
      () => chapterReplacementOperations.id,
      {
        onDelete: "cascade",
      },
    ),
    uploadId: uuid("upload_id").references(() => uploads.id, {
      onDelete: "cascade",
    }),
    storageKey: text("storage_key").notNull(),
    storageProfileId: uuid("storage_profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "restrict" }),
    originRequestId: varchar("origin_request_id", { length: 128 }),
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
    check(
      "storage_cleanup_outbox_one_owner",
      sql`(${table.uploadId} is not null) <> (${table.replacementId} is not null)`,
    ),
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
    uniqueIndex("storage_cleanup_outbox_upload_reason_key_unique").on(
      table.uploadId,
      table.reason,
      table.storageKey,
    ),
    index("storage_cleanup_outbox_upload_idx").on(table.uploadId),
    index("storage_cleanup_outbox_profile_idx").on(table.storageProfileId),
  ],
);
