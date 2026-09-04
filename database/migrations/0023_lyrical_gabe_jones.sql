CREATE TYPE "public"."chapter_replacement_operation_status" AS ENUM('pending_upload', 'uploaded', 'processing', 'ready', 'completing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "chapter_replacement_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"sort_order" integer NOT NULL,
	"candidate_storage_key" text NOT NULL,
	"physical_filename" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"checksum" text NOT NULL,
	"etag" text,
	"stored_at" timestamp with time zone,
	"result_image_id" uuid,
	"result_image_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapter_replacement_items_sort_order_non_negative" CHECK ("chapter_replacement_items"."sort_order" >= 0),
	CONSTRAINT "chapter_replacement_items_size_positive" CHECK ("chapter_replacement_items"."size_bytes" > 0),
	CONSTRAINT "chapter_replacement_items_result_pair" CHECK (("chapter_replacement_items"."result_image_id" is null and "chapter_replacement_items"."result_image_version_id" is null)
        or ("chapter_replacement_items"."result_image_id" is not null and "chapter_replacement_items"."result_image_version_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "chapter_replacement_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"candidate_zip_storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"etag" text,
	"status" "chapter_replacement_operation_status" DEFAULT 'pending_upload' NOT NULL,
	"last_error_code" text,
	"previous_image_count" integer,
	"result_image_count" integer,
	"retained_image_count" integer,
	"created_image_count" integer,
	"retired_image_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "chapter_replacement_operations_candidate_zip_storage_key_unique" UNIQUE("candidate_zip_storage_key"),
	CONSTRAINT "chapter_replacement_operations_size_positive" CHECK ("chapter_replacement_operations"."size_bytes" > 0),
	CONSTRAINT "chapter_replacement_operations_counts_non_negative" CHECK (coalesce("chapter_replacement_operations"."previous_image_count", 0) >= 0
        and coalesce("chapter_replacement_operations"."result_image_count", 0) >= 0
        and coalesce("chapter_replacement_operations"."retained_image_count", 0) >= 0
        and coalesce("chapter_replacement_operations"."created_image_count", 0) >= 0
        and coalesce("chapter_replacement_operations"."retired_image_count", 0) >= 0),
	CONSTRAINT "chapter_replacement_operations_completed_result_required" CHECK ("chapter_replacement_operations"."status" <> 'completed' or (
        "chapter_replacement_operations"."completed_at" is not null
        and "chapter_replacement_operations"."previous_image_count" is not null
        and "chapter_replacement_operations"."result_image_count" is not null
        and "chapter_replacement_operations"."retained_image_count" is not null
        and "chapter_replacement_operations"."created_image_count" is not null
        and "chapter_replacement_operations"."retired_image_count" is not null
      )),
	CONSTRAINT "chapter_replacement_operations_completed_counts_consistent" CHECK ("chapter_replacement_operations"."status" <> 'completed' or (
        "chapter_replacement_operations"."retained_image_count" + "chapter_replacement_operations"."created_image_count" = "chapter_replacement_operations"."result_image_count"
        and "chapter_replacement_operations"."previous_image_count" - "chapter_replacement_operations"."retained_image_count" = "chapter_replacement_operations"."retired_image_count"
      ))
);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "retired_by_chapter_replacement_id" uuid;--> statement-breakpoint
ALTER TABLE "chapter_replacement_items" ADD CONSTRAINT "chapter_replacement_items_operation_id_chapter_replacement_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."chapter_replacement_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_replacement_items" ADD CONSTRAINT "chapter_replacement_items_result_image_id_images_id_fk" FOREIGN KEY ("result_image_id") REFERENCES "public"."images"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_replacement_items" ADD CONSTRAINT "chapter_replacement_items_result_image_version_id_image_versions_id_fk" FOREIGN KEY ("result_image_version_id") REFERENCES "public"."image_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ADD CONSTRAINT "chapter_replacement_operations_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ADD CONSTRAINT "chapter_replacement_operations_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_replacement_items_operation_order_unique" ON "chapter_replacement_items" USING btree ("operation_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_replacement_items_candidate_key_unique" ON "chapter_replacement_items" USING btree ("candidate_storage_key");--> statement-breakpoint
CREATE INDEX "chapter_replacement_items_operation_idx" ON "chapter_replacement_items" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "chapter_replacement_items_result_image_idx" ON "chapter_replacement_items" USING btree ("result_image_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_replacement_operations_active_chapter_unique" ON "chapter_replacement_operations" USING btree ("chapter_id") WHERE "chapter_replacement_operations"."status" in ('pending_upload', 'uploaded', 'processing', 'ready', 'completing');--> statement-breakpoint
CREATE INDEX "chapter_replacement_operations_chapter_idx" ON "chapter_replacement_operations" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_replacement_operations_status_idx" ON "chapter_replacement_operations" USING btree ("status");--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_retired_by_chapter_replacement_id_chapter_replacement_operations_id_fk" FOREIGN KEY ("retired_by_chapter_replacement_id") REFERENCES "public"."chapter_replacement_operations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "images_active_chapter_sort_order_unique" ON "images" USING btree ("chapter_id","sort_order") WHERE "images"."retired_at" is null;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_retirement_pair" CHECK (("images"."retired_at" is null and "images"."retired_by_chapter_replacement_id" is null)
        or ("images"."retired_at" is not null and "images"."retired_by_chapter_replacement_id" is not null));