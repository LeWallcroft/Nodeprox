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

export const uploadStatusEnum = pgEnum("upload_status", [
  "pending",
  "verifying",
  "aborting",
  "uploaded",
]);

export const uploads = pgTable(
  "uploads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    originalFilename: varchar("original_filename", { length: 255 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    etag: text("etag"),
    status: uploadStatusEnum("status").notNull().default("pending"),
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
    check("uploads_size_positive", sql`${table.sizeBytes} > 0`),
    uniqueIndex("uploads_storage_key_unique").on(table.storageKey),
    uniqueIndex("uploads_active_chapter_unique")
      .on(table.chapterId)
      .where(sql`${table.status} <> 'uploaded'`),
    index("uploads_chapter_id_idx").on(table.chapterId),
  ],
);
