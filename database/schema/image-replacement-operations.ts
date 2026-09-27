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
import { users } from "./authentication.js";
import { chapters } from "./chapters.js";
import { images, imageVersions } from "./images.js";
import { storageProfiles } from "./storage-profiles.js";

export const imageReplacementOperationStatusEnum = pgEnum(
  "image_replacement_operation_status",
  ["pending_upload", "uploaded", "completing", "completed", "failed"],
);

export const imageReplacementOperations = pgTable(
  "image_replacement_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    imageId: uuid("image_id")
      .notNull()
      .references(() => images.id),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id),
    requestedByUserId: uuid("requested_by_user_id")
      .notNull()
      .references(() => users.id),
    candidateStorageKey: varchar("candidate_storage_key", {
      length: 512,
    }).notNull(),
    storageProfileId: uuid("storage_profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "restrict" }),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    status: imageReplacementOperationStatusEnum("status")
      .notNull()
      .default("pending_upload"),
    resultImageVersionId: uuid("result_image_version_id").references(
      () => imageVersions.id,
    ),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("image_replacement_operations_candidate_key_unique").on(
      table.candidateStorageKey,
    ),
    index("image_replacement_operations_image_idx").on(table.imageId),
    index("image_replacement_operations_chapter_idx").on(table.chapterId),
    index("image_replacement_operations_status_idx").on(table.status),
    index("image_replacement_operations_image_status_idx").on(
      table.imageId,
      table.status,
    ),
    check(
      "image_replacement_operations_size_positive",
      sql`${table.sizeBytes} > 0`,
    ),
  ],
);
