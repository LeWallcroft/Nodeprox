CREATE TYPE "public"."audit_result" AS ENUM('success', 'rejected', 'failed');--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "result" "audit_result" DEFAULT 'success';--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "chapter_deletion_outbox" ADD COLUMN "origin_request_id" text;--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD COLUMN "origin_request_id" varchar(128);--> statement-breakpoint
CREATE INDEX "audit_log_request_id_idx" ON "audit_log" USING btree ("request_id");