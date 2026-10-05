CREATE TYPE "public"."upload_validation_run_status" AS ENUM('validating', 'accepted', 'rejected', 'retryable_failed', 'retry_exhausted');--> statement-breakpoint
DROP INDEX "chapter_replacement_operations_active_chapter_unique";--> statement-breakpoint
DROP INDEX "uploads_active_chapter_unique";--> statement-breakpoint
ALTER TYPE "public"."chapter_processing_attempt_status" RENAME TO "chapter_processing_attempt_status_old";--> statement-breakpoint
CREATE TYPE "public"."chapter_processing_attempt_status" AS ENUM('processing', 'retryable_failed', 'retry_exhausted', 'terminal_failed', 'succeeded');--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" DROP CONSTRAINT "chapter_processing_attempt_completion_consistent";--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ALTER COLUMN "status" TYPE "public"."chapter_processing_attempt_status" USING "status"::text::"public"."chapter_processing_attempt_status";--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ALTER COLUMN "status" SET DEFAULT 'processing';--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ADD CONSTRAINT "chapter_processing_attempt_completion_consistent" CHECK (("status" = 'processing' and "finished_at" is null) or ("status" <> 'processing' and "finished_at" is not null));--> statement-breakpoint
DROP TYPE "public"."chapter_processing_attempt_status_old";--> statement-breakpoint
ALTER TYPE "public"."chapter_replacement_operation_status" RENAME TO "chapter_replacement_operation_status_old";--> statement-breakpoint
CREATE TYPE "public"."chapter_replacement_operation_status" AS ENUM('pending_upload', 'uploaded', 'validating', 'retry_exhausted', 'processing', 'ready', 'completing', 'completed', 'failed', 'rejected');--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" DROP CONSTRAINT "chapter_replacement_operations_completed_result_required";--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" DROP CONSTRAINT "chapter_replacement_operations_completed_counts_consistent";--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ALTER COLUMN "status" TYPE "public"."chapter_replacement_operation_status" USING "status"::text::"public"."chapter_replacement_operation_status";--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ALTER COLUMN "status" SET DEFAULT 'pending_upload';--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ADD CONSTRAINT "chapter_replacement_operations_completed_result_required" CHECK ("status" <> 'completed' or ("completed_at" is not null and "previous_image_count" is not null and "result_image_count" is not null and "retained_image_count" is not null and "created_image_count" is not null and "retired_image_count" is not null));--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ADD CONSTRAINT "chapter_replacement_operations_completed_counts_consistent" CHECK ("status" <> 'completed' or ("retained_image_count" + "created_image_count" = "result_image_count" and "previous_image_count" - "retained_image_count" = "retired_image_count"));--> statement-breakpoint
DROP TYPE "public"."chapter_replacement_operation_status_old";--> statement-breakpoint
ALTER TYPE "public"."chapter_import_item_status" RENAME TO "chapter_import_item_status_old";--> statement-breakpoint
CREATE TYPE "public"."chapter_import_item_status" AS ENUM('pending', 'uploading', 'validating', 'uploaded', 'processing', 'ready', 'rejected', 'retry_exhausted', 'failed');--> statement-breakpoint
ALTER TABLE "chapter_import_items" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "chapter_import_items" ALTER COLUMN "status" TYPE "public"."chapter_import_item_status" USING "status"::text::"public"."chapter_import_item_status";--> statement-breakpoint
ALTER TABLE "chapter_import_items" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
DROP TYPE "public"."chapter_import_item_status_old";--> statement-breakpoint
ALTER TYPE "public"."upload_status" RENAME TO "upload_status_old";--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'verifying', 'validating', 'retry_exhausted', 'aborting', 'uploaded', 'rejected');--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "status" TYPE "public"."upload_status" USING "status"::text::"public"."upload_status";--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
DROP TYPE "public"."upload_status_old";--> statement-breakpoint
CREATE TABLE "upload_validation_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"extension" varchar(10) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"sort_order" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"width_px" integer,
	"height_px" integer,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_validation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"code" varchar(100) NOT NULL,
	"severity" varchar(10) NOT NULL,
	"file_index" integer,
	"filename" varchar(255),
	"actual" jsonb,
	"expected" jsonb,
	CONSTRAINT "upload_validation_issues_severity_valid" CHECK ("upload_validation_issues"."severity" in ('error', 'warning'))
);
--> statement-breakpoint
CREATE TABLE "upload_validation_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid,
	"replacement_id" uuid,
	"origin_request_id" varchar(128),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_validation_outbox_one_owner" CHECK (("upload_validation_outbox"."upload_id" is not null) <> ("upload_validation_outbox"."replacement_id" is not null)),
	CONSTRAINT "upload_validation_outbox_status_valid" CHECK ("upload_validation_outbox"."status" in ('pending', 'enqueued'))
);
--> statement-breakpoint
CREATE TABLE "upload_validation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid,
	"replacement_id" uuid,
	"attempt_number" integer NOT NULL,
	"status" "upload_validation_run_status" DEFAULT 'validating' NOT NULL,
	"job_id" varchar(128),
	"job_attempt" integer,
	"request_id" varchar(128),
	"error_code" varchar(100),
	"provider_code" varchar(100),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "upload_validation_runs_one_owner" CHECK (("upload_validation_runs"."upload_id" is not null) <> ("upload_validation_runs"."replacement_id" is not null)),
	CONSTRAINT "upload_validation_runs_attempt_positive" CHECK ("upload_validation_runs"."attempt_number" > 0)
);
--> statement-breakpoint
ALTER TABLE "upload_validation_entries" ADD CONSTRAINT "upload_validation_entries_run_id_upload_validation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."upload_validation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_validation_issues" ADD CONSTRAINT "upload_validation_issues_run_id_upload_validation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."upload_validation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_validation_outbox" ADD CONSTRAINT "upload_validation_outbox_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_validation_outbox" ADD CONSTRAINT "upload_validation_outbox_replacement_id_chapter_replacement_operations_id_fk" FOREIGN KEY ("replacement_id") REFERENCES "public"."chapter_replacement_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_validation_runs" ADD CONSTRAINT "upload_validation_runs_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_validation_runs" ADD CONSTRAINT "upload_validation_runs_replacement_id_chapter_replacement_operations_id_fk" FOREIGN KEY ("replacement_id") REFERENCES "public"."chapter_replacement_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_validation_entries_run_filename_unique" ON "upload_validation_entries" USING btree ("run_id","filename");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_validation_entries_run_sort_order_unique" ON "upload_validation_entries" USING btree ("run_id","sort_order");--> statement-breakpoint
CREATE INDEX "upload_validation_issues_run_idx" ON "upload_validation_issues" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "upload_validation_outbox_pending_idx" ON "upload_validation_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_validation_runs_upload_attempt_unique" ON "upload_validation_runs" USING btree ("upload_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_validation_runs_replacement_attempt_unique" ON "upload_validation_runs" USING btree ("replacement_id","attempt_number");--> statement-breakpoint
CREATE INDEX "upload_validation_runs_upload_status_idx" ON "upload_validation_runs" USING btree ("upload_id","status");--> statement-breakpoint
CREATE INDEX "upload_validation_runs_replacement_status_idx" ON "upload_validation_runs" USING btree ("replacement_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_replacement_operations_active_chapter_unique" ON "chapter_replacement_operations" USING btree ("chapter_id") WHERE "chapter_replacement_operations"."status" in ('pending_upload', 'validating', 'retry_exhausted', 'uploaded', 'processing', 'ready', 'completing');--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_active_chapter_unique" ON "uploads" USING btree ("chapter_id") WHERE "uploads"."status" in ('pending', 'verifying', 'validating', 'retry_exhausted', 'aborting');
