ALTER TABLE "audit_log"
  ADD COLUMN "request_method" text,
  ADD COLUMN "request_path" text,
  ADD COLUMN "duration_ms" numeric,
  ADD COLUMN "client_browser" text,
  ADD COLUMN "client_operating_system" text;
--> statement-breakpoint
ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_duration_ms_non_negative"
  CHECK ("duration_ms" IS NULL OR "duration_ms" >= 0);
--> statement-breakpoint
CREATE INDEX "audit_log_request_id_created_at_idx"
  ON "audit_log" USING btree ("request_id", "created_at" DESC);
