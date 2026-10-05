ALTER TYPE "public"."chapter_replacement_operation_status" ADD VALUE 'terminal_failed';--> statement-breakpoint
ALTER TYPE "public"."storage_cleanup_reason" ADD VALUE 'chapter_source_zip';--> statement-breakpoint
ALTER TYPE "public"."upload_validation_run_status" ADD VALUE 'terminal_failed';--> statement-breakpoint
ALTER TYPE "public"."chapter_import_item_status" ADD VALUE 'terminal_failed' BEFORE 'failed';--> statement-breakpoint
ALTER TYPE "public"."upload_status" ADD VALUE 'terminal_failed';--> statement-breakpoint
DROP INDEX "chapter_replacement_processing_outbox_replacement_unique";--> statement-breakpoint
DROP INDEX "processing_outbox_upload_unique";--> statement-breakpoint
ALTER TABLE "storage_cleanup_outbox" ALTER COLUMN "replacement_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ADD COLUMN "validation_run_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_cleanup_outbox" ADD COLUMN "upload_id" uuid;--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ADD CONSTRAINT "chapter_processing_attempts_validation_run_id_upload_validation_runs_id_fk" FOREIGN KEY ("validation_run_id") REFERENCES "public"."upload_validation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_cleanup_outbox" ADD CONSTRAINT "storage_cleanup_outbox_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_replacement_processing_outbox_replacement_idx" ON "chapter_replacement_processing_outbox" USING btree ("replacement_id");--> statement-breakpoint
CREATE INDEX "processing_outbox_upload_idx" ON "processing_outbox" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_cleanup_outbox_upload_reason_key_unique" ON "storage_cleanup_outbox" USING btree ("upload_id","reason","storage_key");--> statement-breakpoint
CREATE INDEX "storage_cleanup_outbox_upload_idx" ON "storage_cleanup_outbox" USING btree ("upload_id");--> statement-breakpoint
ALTER TABLE "storage_cleanup_outbox" ADD CONSTRAINT "storage_cleanup_outbox_one_owner" CHECK (("storage_cleanup_outbox"."upload_id" is not null) <> ("storage_cleanup_outbox"."replacement_id" is not null));