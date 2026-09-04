CREATE TYPE "public"."chapter_replacement_processing_outbox_status" AS ENUM('pending', 'enqueued');--> statement-breakpoint
CREATE TYPE "public"."storage_cleanup_reason" AS ENUM('replacement_source_zip', 'replacement_failed_candidate');--> statement-breakpoint
CREATE TYPE "public"."storage_cleanup_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "chapter_replacement_processing_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replacement_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"status" "chapter_replacement_processing_outbox_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enqueued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "storage_cleanup_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replacement_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"reason" "storage_cleanup_reason" NOT NULL,
	"status" "storage_cleanup_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_replacement_processing_outbox" ADD CONSTRAINT "chapter_replacement_processing_outbox_replacement_id_chapter_replacement_operations_id_fk" FOREIGN KEY ("replacement_id") REFERENCES "public"."chapter_replacement_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_replacement_processing_outbox" ADD CONSTRAINT "chapter_replacement_processing_outbox_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_cleanup_outbox" ADD CONSTRAINT "storage_cleanup_outbox_replacement_id_chapter_replacement_operations_id_fk" FOREIGN KEY ("replacement_id") REFERENCES "public"."chapter_replacement_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_replacement_processing_outbox_replacement_unique" ON "chapter_replacement_processing_outbox" USING btree ("replacement_id");--> statement-breakpoint
CREATE INDEX "chapter_replacement_processing_outbox_pending_idx" ON "chapter_replacement_processing_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "chapter_replacement_processing_outbox_chapter_idx" ON "chapter_replacement_processing_outbox" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_cleanup_outbox_replacement_reason_key_unique" ON "storage_cleanup_outbox" USING btree ("replacement_id","reason","storage_key");--> statement-breakpoint
CREATE INDEX "storage_cleanup_outbox_pending_idx" ON "storage_cleanup_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "storage_cleanup_outbox_replacement_idx" ON "storage_cleanup_outbox" USING btree ("replacement_id");