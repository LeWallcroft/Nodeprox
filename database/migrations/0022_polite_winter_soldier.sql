CREATE TYPE "public"."image_replacement_operation_status" AS ENUM('pending_upload', 'uploaded', 'completing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "image_replacement_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"candidate_storage_key" varchar(512) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" "image_replacement_operation_status" DEFAULT 'pending_upload' NOT NULL,
	"result_image_version_id" uuid,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "image_replacement_operations_size_positive" CHECK ("image_replacement_operations"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "image_replacement_operations" ADD CONSTRAINT "image_replacement_operations_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_replacement_operations" ADD CONSTRAINT "image_replacement_operations_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_replacement_operations" ADD CONSTRAINT "image_replacement_operations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_replacement_operations" ADD CONSTRAINT "image_replacement_operations_result_image_version_id_image_versions_id_fk" FOREIGN KEY ("result_image_version_id") REFERENCES "public"."image_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_replacement_operations_candidate_key_unique" ON "image_replacement_operations" USING btree ("candidate_storage_key");--> statement-breakpoint
CREATE INDEX "image_replacement_operations_image_idx" ON "image_replacement_operations" USING btree ("image_id");--> statement-breakpoint
CREATE INDEX "image_replacement_operations_chapter_idx" ON "image_replacement_operations" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "image_replacement_operations_status_idx" ON "image_replacement_operations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "image_replacement_operations_image_status_idx" ON "image_replacement_operations" USING btree ("image_id","status");