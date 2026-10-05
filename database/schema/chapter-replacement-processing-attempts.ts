import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { chapterReplacementOperations } from "./chapter-replacement-operations.js";
import { uploadValidationRuns } from "./upload-validation.js";

export const chapterReplacementProcessingAttemptStatusEnum = pgEnum(
  "chapter_replacement_processing_attempt_status",
  [
    "processing",
    "retryable_failed",
    "retry_exhausted",
    "terminal_failed",
    "succeeded",
  ],
);

export const chapterReplacementProcessingAttempts = pgTable(
  "chapter_replacement_processing_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    replacementId: uuid("replacement_id")
      .notNull()
      .references(() => chapterReplacementOperations.id, {
        onDelete: "cascade",
      }),
    validationRunId: uuid("validation_run_id").references(
      () => uploadValidationRuns.id,
      { onDelete: "set null" },
    ),
    attemptNumber: integer("attempt_number").notNull(),
    status: chapterReplacementProcessingAttemptStatusEnum("status")
      .notNull()
      .default("processing"),
    jobId: varchar("job_id", { length: 255 }),
    jobAttempt: integer("job_attempt"),
    requestId: varchar("request_id", { length: 128 }),
    errorCode: varchar("error_code", { length: 100 }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("chapter_replacement_processing_attempt_number_unique").on(
      table.replacementId,
      table.attemptNumber,
    ),
    index("chapter_replacement_processing_attempt_status_idx").on(
      table.replacementId,
      table.status,
    ),
    check(
      "chapter_replacement_processing_attempt_positive",
      sql`${table.attemptNumber} > 0`,
    ),
    check(
      "chapter_replacement_processing_attempt_completion_consistent",
      sql`(${table.status} = 'processing' and ${table.finishedAt} is null) or (${table.status} <> 'processing' and ${table.finishedAt} is not null)`,
    ),
  ],
);
