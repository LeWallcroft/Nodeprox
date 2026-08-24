CREATE TYPE "public"."processing_outbox_status" AS ENUM('pending', 'enqueued');--> statement-breakpoint
CREATE TABLE "processing_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"series_id" uuid NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"status" "processing_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD CONSTRAINT "processing_outbox_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD CONSTRAINT "processing_outbox_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "processing_outbox_upload_unique" ON "processing_outbox" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "processing_outbox_pending_idx" ON "processing_outbox" USING btree ("status", "available_at");--> statement-breakpoint
CREATE INDEX "processing_outbox_chapter_idx" ON "processing_outbox" USING btree ("chapter_id");
