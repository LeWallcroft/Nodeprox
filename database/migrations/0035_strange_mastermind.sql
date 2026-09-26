CREATE TYPE "public"."chapter_processing_attempt_status" AS ENUM('processing', 'retryable_failed', 'terminal_failed', 'succeeded');--> statement-breakpoint
CREATE TABLE "chapter_processing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"upload_id" uuid,
	"job_id" varchar(255),
	"job_attempt" integer,
	"attempt_number" integer NOT NULL,
	"status" "chapter_processing_attempt_status" DEFAULT 'processing' NOT NULL,
	"error_code" varchar(64),
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "chapter_processing_attempt_number_positive" CHECK ("chapter_processing_attempts"."attempt_number" > 0),
	CONSTRAINT "chapter_processing_attempt_job_identity_complete" CHECK (("chapter_processing_attempts"."job_id" is null and "chapter_processing_attempts"."job_attempt" is null) or ("chapter_processing_attempts"."job_id" is not null and "chapter_processing_attempts"."job_attempt" is not null and "chapter_processing_attempts"."job_attempt" > 0)),
	CONSTRAINT "chapter_processing_attempt_completion_consistent" CHECK (("chapter_processing_attempts"."status" = 'processing' and "chapter_processing_attempts"."finished_at" is null) or ("chapter_processing_attempts"."status" <> 'processing' and "chapter_processing_attempts"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ADD CONSTRAINT "chapter_processing_attempts_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ADD CONSTRAINT "chapter_processing_attempts_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_processing_attempt_chapter_number_unique" ON "chapter_processing_attempts" USING btree ("chapter_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_processing_attempt_job_invocation_unique" ON "chapter_processing_attempts" USING btree ("job_id","job_attempt") WHERE "chapter_processing_attempts"."job_id" is not null;--> statement-breakpoint
CREATE INDEX "chapter_processing_attempt_chapter_started_idx" ON "chapter_processing_attempts" USING btree ("chapter_id","started_at");
