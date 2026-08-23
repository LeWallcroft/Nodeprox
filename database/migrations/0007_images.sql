CREATE TABLE "images" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL, "chapter_id" uuid NOT NULL, "filename" varchar(255) NOT NULL, "storage_key" varchar(512) NOT NULL, "extension" varchar(10) NOT NULL, "content_type" varchar(128) NOT NULL, "size_bytes" integer NOT NULL, "sort_order" integer NOT NULL, "checksum" text NOT NULL, "created_at" timestamp with time zone DEFAULT now() NOT NULL, "updated_at" timestamp with time zone DEFAULT now() NOT NULL);
--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "images_chapter_filename_unique" ON "images" USING btree ("chapter_id", "filename");
--> statement-breakpoint
CREATE INDEX "images_chapter_idx" ON "images" USING btree ("chapter_id");
--> statement-breakpoint
CREATE INDEX "images_chapter_sort_order_idx" ON "images" USING btree ("chapter_id", "sort_order");
