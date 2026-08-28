import {
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./authentication.js";

export const chapterDeletionOutboxStatusEnum = pgEnum(
  "chapter_deletion_outbox_status",
  ["pending", "enqueued", "completed"],
);

export const chapterDeletionOutbox = pgTable(
  "chapter_deletion_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: chapterDeletionOutboxStatusEnum("status")
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("chapter_deletion_outbox_chapter_unique").on(table.chapterId),
    index("chapter_deletion_outbox_pending_idx").on(
      table.status,
      table.availableAt,
    ),
  ],
);
