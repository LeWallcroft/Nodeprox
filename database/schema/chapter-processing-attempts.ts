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
import { chapters } from "./chapters.js";
import { uploads } from "./uploads.js";

export const chapterProcessingAttemptStatusEnum = pgEnum(
  "chapter_processing_attempt_status",
  ["processing", "retryable_failed", "terminal_failed", "succeeded"],
);

export const chapterProcessingAttempts = pgTable(
  "chapter_processing_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chapterId: uuid("chapter_id")
      .notNull()
      .references(() => chapters.id, { onDelete: "cascade" }),
    uploadId: uuid("upload_id").references(() => uploads.id, {
      onDelete: "set null",
    }),
    jobId: varchar("job_id", { length: 255 }),
    jobAttempt: integer("job_attempt"),
    attemptNumber: integer("attempt_number").notNull(),
    status: chapterProcessingAttemptStatusEnum("status")
      .notNull()
      .default("processing"),
    errorCode: varchar("error_code", { length: 64 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("chapter_processing_attempt_chapter_number_unique").on(
      table.chapterId,
      table.attemptNumber,
    ),
    uniqueIndex("chapter_processing_attempt_job_invocation_unique")
      .on(table.jobId, table.jobAttempt)
      .where(sql`${table.jobId} is not null`),
    index("chapter_processing_attempt_chapter_started_idx").on(
      table.chapterId,
      table.startedAt,
    ),
    check(
      "chapter_processing_attempt_number_positive",
      sql`${table.attemptNumber} > 0`,
    ),
    check(
      "chapter_processing_attempt_job_identity_complete",
      sql`(${table.jobId} is null and ${table.jobAttempt} is null) or (${table.jobId} is not null and ${table.jobAttempt} is not null and ${table.jobAttempt} > 0)`,
    ),
    check(
      "chapter_processing_attempt_completion_consistent",
      sql`(${table.status} = 'processing' and ${table.finishedAt} is null) or (${table.status} <> 'processing' and ${table.finishedAt} is not null)`,
    ),
  ],
);
