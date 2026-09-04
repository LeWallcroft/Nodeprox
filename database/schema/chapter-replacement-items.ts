import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { chapterReplacementOperations } from "./chapter-replacement-operations.js";
import { images, imageVersions } from "./images.js";

export const chapterReplacementItems = pgTable(
  "chapter_replacement_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => chapterReplacementOperations.id, {
        onDelete: "cascade",
      }),
    sortOrder: integer("sort_order").notNull(),
    candidateStorageKey: text("candidate_storage_key").notNull(),
    physicalFilename: text("physical_filename").notNull(),
    originalFilename: text("original_filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    checksum: text("checksum").notNull(),
    etag: text("etag"),
    storedAt: timestamp("stored_at", { withTimezone: true }),
    resultImageId: uuid("result_image_id").references(() => images.id, {
      onDelete: "restrict",
    }),
    resultImageVersionId: uuid("result_image_version_id").references(
      () => imageVersions.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chapter_replacement_items_sort_order_non_negative",
      sql`${table.sortOrder} >= 0`,
    ),
    check(
      "chapter_replacement_items_size_positive",
      sql`${table.sizeBytes} > 0`,
    ),
    check(
      "chapter_replacement_items_result_pair",
      sql`(${table.resultImageId} is null and ${table.resultImageVersionId} is null)
        or (${table.resultImageId} is not null and ${table.resultImageVersionId} is not null)`,
    ),
    uniqueIndex("chapter_replacement_items_operation_order_unique").on(
      table.operationId,
      table.sortOrder,
    ),
    uniqueIndex("chapter_replacement_items_candidate_key_unique").on(
      table.candidateStorageKey,
    ),
    index("chapter_replacement_items_operation_idx").on(table.operationId),
    index("chapter_replacement_items_result_image_idx").on(table.resultImageId),
  ],
);
