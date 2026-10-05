CREATE TYPE "public"."chapter_replacement_processing_attempt_status" AS ENUM('processing', 'retryable_failed', 'retry_exhausted', 'terminal_failed', 'succeeded');--> statement-breakpoint
CREATE TABLE "chapter_replacement_processing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replacement_id" uuid NOT NULL,
	"validation_run_id" uuid,
	"attempt_number" integer NOT NULL,
	"status" "chapter_replacement_processing_attempt_status" DEFAULT 'processing' NOT NULL,
	"job_id" varchar(255),
	"job_attempt" integer,
	"request_id" varchar(128),
	"error_code" varchar(100),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "chapter_replacement_processing_attempt_positive" CHECK ("chapter_replacement_processing_attempts"."attempt_number" > 0),
	CONSTRAINT "chapter_replacement_processing_attempt_completion_consistent" CHECK (("chapter_replacement_processing_attempts"."status" = 'processing' and "chapter_replacement_processing_attempts"."finished_at" is null) or ("chapter_replacement_processing_attempts"."status" <> 'processing' and "chapter_replacement_processing_attempts"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "chapter_replacement_processing_attempts" ADD CONSTRAINT "chapter_replacement_processing_attempts_replacement_id_chapter_replacement_operations_id_fk" FOREIGN KEY ("replacement_id") REFERENCES "public"."chapter_replacement_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_replacement_processing_attempts" ADD CONSTRAINT "chapter_replacement_processing_attempts_validation_run_id_upload_validation_runs_id_fk" FOREIGN KEY ("validation_run_id") REFERENCES "public"."upload_validation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_replacement_processing_attempt_number_unique" ON "chapter_replacement_processing_attempts" USING btree ("replacement_id","attempt_number");--> statement-breakpoint
CREATE INDEX "chapter_replacement_processing_attempt_status_idx" ON "chapter_replacement_processing_attempts" USING btree ("replacement_id","status");