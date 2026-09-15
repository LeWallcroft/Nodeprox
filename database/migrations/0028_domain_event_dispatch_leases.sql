ALTER TABLE "domain_event_outbox"
  ADD COLUMN "claimed_at" timestamp with time zone,
  ADD COLUMN "claim_token" text,
  ADD COLUMN "locked_until" timestamp with time zone,
  ADD COLUMN "last_attempt_at" timestamp with time zone,
  ADD COLUMN "next_attempt_at" timestamp with time zone,
  ADD COLUMN "last_error_code" text;
--> statement-breakpoint
CREATE INDEX "domain_event_outbox_claimable_idx"
  ON "domain_event_outbox"
  USING btree ("processed_at", "next_attempt_at", "locked_until", "occurred_at");
