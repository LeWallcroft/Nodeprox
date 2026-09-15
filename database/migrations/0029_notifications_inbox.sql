CREATE TABLE "notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "source_event_id" uuid NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "message" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "action_key" text,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_source_event_unique"
  ON "notifications" USING btree ("user_id", "source_event_id");
--> statement-breakpoint
CREATE INDEX "notifications_user_created_at_idx"
  ON "notifications" USING btree ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX "notifications_user_read_at_idx"
  ON "notifications" USING btree ("user_id", "read_at");
