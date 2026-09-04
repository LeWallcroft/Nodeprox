import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { chapterReplacementOperations } from "./chapter-replacement-operations.js";
import { chapters } from "./chapters.js";

export const chapterReplacementProcessingOutboxStatusEnum = pgEnum(
  "chapter_replacement_processing_outbox_status",
  ["pending", "enqueued"],
);

export const chapterReplacementProcessingOutbox = pgTable(
  "chapter_replacement_processing_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    replacementId: uuid("replacement_id")
      .notNull()
      .references(() => chapterReplacementOperations.id, {
        onDelete: "cascade",
      }),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    status: chapterReplacementProcessingOutboxStatusEnum("status")
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    enqueuedAt: timestamp("enqueued_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chapter_replacement_processing_outbox_replacement_unique").on(
      table.replacementId,
    ),
    index("chapter_replacement_processing_outbox_pending_idx").on(
      table.status,
      table.availableAt,
    ),
    index("chapter_replacement_processing_outbox_chapter_idx").on(
      table.chapterId,
    ),
  ],
);
