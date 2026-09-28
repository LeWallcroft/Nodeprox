import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";
import { chapters } from "./chapters.js";
import { storageProfiles } from "./storage-profiles.js";

export const chapterReplacementOperationStatusEnum = pgEnum(
  "chapter_replacement_operation_status",
  [
    "pending_upload",
    "uploaded",
    "processing",
    "ready",
    "completing",
    "completed",
    "failed",
  ],
);

export const chapterReplacementOperations = pgTable(
  "chapter_replacement_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "restrict" }),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    candidateZipStorageKey: text("candidate_zip_storage_key")
      .notNull()
      .unique(),
    storageProfileId: uuid("storage_profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "restrict" }),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    etag: text("etag"),
    status: chapterReplacementOperationStatusEnum("status")
      .notNull()
      .default("pending_upload"),
    lastErrorCode: text("last_error_code"),
    previousImageCount: integer("previous_image_count"),
    resultImageCount: integer("result_image_count"),
    retainedImageCount: integer("retained_image_count"),
    createdImageCount: integer("created_image_count"),
    retiredImageCount: integer("retired_image_count"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "chapter_replacement_operations_size_positive",
      sql`${table.sizeBytes} > 0`,
    ),
    check(
      "chapter_replacement_operations_counts_non_negative",
      sql`coalesce(${table.previousImageCount}, 0) >= 0
        and coalesce(${table.resultImageCount}, 0) >= 0
        and coalesce(${table.retainedImageCount}, 0) >= 0
        and coalesce(${table.createdImageCount}, 0) >= 0
        and coalesce(${table.retiredImageCount}, 0) >= 0`,
    ),
    check(
      "chapter_replacement_operations_completed_result_required",
      sql`${table.status} <> 'completed' or (
        ${table.completedAt} is not null
        and ${table.previousImageCount} is not null
        and ${table.resultImageCount} is not null
        and ${table.retainedImageCount} is not null
        and ${table.createdImageCount} is not null
        and ${table.retiredImageCount} is not null
      )`,
    ),
    check(
      "chapter_replacement_operations_completed_counts_consistent",
      sql`${table.status} <> 'completed' or (
        ${table.retainedImageCount} + ${table.createdImageCount} = ${table.resultImageCount}
        and ${table.previousImageCount} - ${table.retainedImageCount} = ${table.retiredImageCount}
      )`,
    ),
    uniqueIndex("chapter_replacement_operations_active_chapter_unique")
      .on(table.chapterId)
      .where(
        sql`${table.status} in ('pending_upload', 'uploaded', 'processing', 'ready', 'completing')`,
      ),
    index("chapter_replacement_operations_chapter_idx").on(table.chapterId),
    index("chapter_replacement_operations_status_idx").on(table.status),
  ],
);
