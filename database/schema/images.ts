import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { chapters } from "./chapters.js";
export const images = pgTable(
  "images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    extension: varchar("extension", { length: 10 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sortOrder: integer("sort_order").notNull(),
    checksum: text("checksum").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("images_chapter_filename_unique").on(
      table.chapterId,
      table.filename,
    ),
    index("images_chapter_idx").on(table.chapterId),
    index("images_chapter_sort_order_idx").on(table.chapterId, table.sortOrder),
  ],
);
