import { sql } from "drizzle-orm";
import type { MediaWarning } from "@nodeprox/types";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { chapterReplacementOperations } from "./chapter-replacement-operations.js";
import { uploads } from "./uploads.js";

export const uploadValidationRunStatusEnum = pgEnum(
  "upload_validation_run_status",
  [
    "validating",
    "accepted",
    "rejected",
    "retryable_failed",
    "retry_exhausted",
    "terminal_failed",
  ],
);

export const uploadValidationRuns = pgTable(
  "upload_validation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id").references(() => uploads.id, {
      onDelete: "cascade",
    }),
    replacementId: uuid("replacement_id").references(
      () => chapterReplacementOperations.id,
      { onDelete: "cascade" },
    ),
    attemptNumber: integer("attempt_number").notNull(),
    status: uploadValidationRunStatusEnum("status")
      .notNull()
      .default("validating"),
    jobId: varchar("job_id", { length: 128 }),
    jobAttempt: integer("job_attempt"),
    requestId: varchar("request_id", { length: 128 }),
    errorCode: varchar("error_code", { length: 100 }),
    providerCode: varchar("provider_code", { length: 100 }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "upload_validation_runs_one_owner",
      sql`(${table.uploadId} is not null) <> (${table.replacementId} is not null)`,
    ),
    check(
      "upload_validation_runs_attempt_positive",
      sql`${table.attemptNumber} > 0`,
    ),
    uniqueIndex("upload_validation_runs_upload_attempt_unique").on(
      table.uploadId,
      table.attemptNumber,
    ),
    uniqueIndex("upload_validation_runs_replacement_attempt_unique").on(
      table.replacementId,
      table.attemptNumber,
    ),
    index("upload_validation_runs_upload_status_idx").on(
      table.uploadId,
      table.status,
    ),
    index("upload_validation_runs_replacement_status_idx").on(
      table.replacementId,
      table.status,
    ),
  ],
);

export const uploadValidationEntries = pgTable(
  "upload_validation_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => uploadValidationRuns.id, { onDelete: "cascade" }),
    filename: varchar("filename", { length: 255 }).notNull(),
    extension: varchar("extension", { length: 10 }).notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    warnings: jsonb("warnings")
      .$type<readonly MediaWarning[]>()
      .notNull()
      .default([]),
  },
  (table) => [
    uniqueIndex("upload_validation_entries_run_filename_unique").on(
      table.runId,
      table.filename,
    ),
    uniqueIndex("upload_validation_entries_run_sort_order_unique").on(
      table.runId,
      table.sortOrder,
    ),
  ],
);

export const uploadValidationIssues = pgTable(
  "upload_validation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => uploadValidationRuns.id, { onDelete: "cascade" }),
    code: varchar("code", { length: 100 }).notNull(),
    severity: varchar("severity", { length: 10 }).notNull(),
    fileIndex: integer("file_index"),
    filename: varchar("filename", { length: 255 }),
    actual: jsonb("actual").$type<Record<string, unknown>>(),
    expected: jsonb("expected").$type<Record<string, unknown>>(),
  },
  (table) => [
    check(
      "upload_validation_issues_severity_valid",
      sql`${table.severity} in ('error', 'warning')`,
    ),
    index("upload_validation_issues_run_idx").on(table.runId),
  ],
);

export const uploadValidationOutbox = pgTable(
  "upload_validation_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id").references(() => uploads.id, {
      onDelete: "cascade",
    }),
    replacementId: uuid("replacement_id").references(
      () => chapterReplacementOperations.id,
      { onDelete: "cascade" },
    ),
    originRequestId: varchar("origin_request_id", { length: 128 }),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
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
    check(
      "upload_validation_outbox_one_owner",
      sql`(${table.uploadId} is not null) <> (${table.replacementId} is not null)`,
    ),
    check(
      "upload_validation_outbox_status_valid",
      sql`${table.status} in ('pending', 'enqueued')`,
    ),
    index("upload_validation_outbox_pending_idx").on(
      table.status,
      table.availableAt,
    ),
  ],
);
