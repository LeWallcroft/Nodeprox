import { sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";
import { chapters } from "./chapters.js";
import { series } from "./series.js";
import { uploads } from "./uploads.js";

export const chapterImportItemStatusEnum = pgEnum(
  "chapter_import_item_status",
  ["pending", "uploading", "uploaded", "processing", "ready", "failed"],
);

export const chapterImportBatches = pgTable(
  "chapter_import_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesId: uuid("series_id")
      .notNull()
      .references(() => series.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
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
    index("chapter_import_batches_series_idx").on(
      table.seriesId,
      table.createdAt,
    ),
  ],
);

export const chapterImportItems = pgTable(
  "chapter_import_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => chapterImportBatches.id, { onDelete: "cascade" }),
    clientId: varchar("client_id", { length: 100 }).notNull(),
    chapterNumber: numeric("chapter_number", {
      precision: 10,
      scale: 3,
      mode: "number",
    }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    chapterId: uuid("chapter_id").references(() => chapters.id, {
      onDelete: "set null",
    }),
    uploadId: uuid("upload_id").references(() => uploads.id, {
      onDelete: "set null",
    }),
    status: chapterImportItemStatusEnum("status").notNull().default("pending"),
    errorCode: varchar("error_code", { length: 100 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chapter_import_items_number_non_negative",
      sql`${table.chapterNumber} >= 0`,
    ),
    uniqueIndex("chapter_import_items_client_unique").on(
      table.batchId,
      table.clientId,
    ),
    index("chapter_import_items_chapter_idx").on(table.chapterId),
    index("chapter_import_items_upload_idx").on(table.uploadId),
  ],
);
