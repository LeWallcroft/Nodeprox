CREATE TYPE "public"."chapter_deletion_outbox_status" AS ENUM('pending', 'enqueued', 'completed');--> statement-breakpoint
ALTER TYPE "public"."chapter_status" ADD VALUE 'deleting';--> statement-breakpoint
CREATE TABLE "chapter_deletion_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "chapter_deletion_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_deletion_outbox" ADD CONSTRAINT "chapter_deletion_outbox_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_deletion_outbox_chapter_unique" ON "chapter_deletion_outbox" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_deletion_outbox_pending_idx" ON "chapter_deletion_outbox" USING btree ("status","available_at");