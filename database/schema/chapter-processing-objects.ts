import {
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { chapterProcessingAttempts } from "./chapter-processing-attempts.js";
import { storageProfiles } from "./storage-profiles.js";

export const chapterProcessingObjectStatusEnum = pgEnum(
  "chapter_processing_object_status",
  ["reserved", "created", "reused", "published", "cleanup_pending", "cleaned"],
);

export const chapterProcessingObjects = pgTable(
  "chapter_processing_objects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => chapterProcessingAttempts.id, { onDelete: "cascade" }),
    storageKey: varchar("storage_key", { length: 512 }).notNull(),
    storageProfileId: uuid("storage_profile_id")
      .notNull()
      .references(() => storageProfiles.id, { onDelete: "restrict" }),
    checksum: varchar("checksum", { length: 64 }).notNull(),
    status: chapterProcessingObjectStatusEnum("status")
      .notNull()
      .default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chapter_processing_object_attempt_key_unique").on(
      table.attemptId,
      table.storageKey,
    ),
    index("chapter_processing_object_status_idx").on(
      table.status,
      table.createdAt,
    ),
    index("chapter_processing_object_key_idx").on(table.storageKey),
    index("chapter_processing_object_profile_idx").on(table.storageProfileId),
  ],
);
