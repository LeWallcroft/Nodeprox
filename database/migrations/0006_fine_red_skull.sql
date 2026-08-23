CREATE TYPE "public"."upload_status" AS ENUM('pending', 'uploaded');--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"size_bytes" integer NOT NULL,
	"etag" text,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_storage_key_unique" ON "uploads" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_active_chapter_unique" ON "uploads" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "uploads_chapter_id_idx" ON "uploads" USING btree ("chapter_id");