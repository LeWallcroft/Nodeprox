CREATE INDEX "audit_log_created_at_id_idx"
  ON "audit_log" USING btree ("created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "audit_log_result_created_at_idx"
  ON "audit_log" USING btree ("result", "created_at" DESC);
