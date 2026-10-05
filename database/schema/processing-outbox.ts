import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { chapters } from "./chapters.js";
import { uploads } from "./uploads.js";
import { storageProfiles } from "./storage-profiles.js";

export const processingOutboxStatusEnum = pgEnum("processing_outbox_status", [
  "pending",
  "enqueued",
]);

export const processingOutbox = pgTable(
  "processing_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    seriesId: uuid("series_id").notNull(),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    storageProfileId: uuid("storage_profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "restrict" }),
    originRequestId: varchar("origin_request_id", { length: 128 }),
    status: processingOutboxStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("processing_outbox_upload_idx").on(table.uploadId),
    index("processing_outbox_pending_idx").on(table.status, table.availableAt),
    index("processing_outbox_chapter_idx").on(table.chapterId),
  ],
);
