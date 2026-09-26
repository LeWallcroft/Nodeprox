CREATE TYPE "public"."chapter_processing_object_status" AS ENUM('reserved', 'created', 'reused', 'published', 'cleanup_pending', 'cleaned');--> statement-breakpoint
CREATE TABLE "chapter_processing_objects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"status" "chapter_processing_object_status" DEFAULT 'reserved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_processing_objects" ADD CONSTRAINT "chapter_processing_objects_attempt_id_chapter_processing_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."chapter_processing_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_processing_object_attempt_key_unique" ON "chapter_processing_objects" USING btree ("attempt_id","storage_key");--> statement-breakpoint
CREATE INDEX "chapter_processing_object_status_idx" ON "chapter_processing_objects" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "chapter_processing_object_key_idx" ON "chapter_processing_objects" USING btree ("storage_key");