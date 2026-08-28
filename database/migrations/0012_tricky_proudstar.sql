CREATE TYPE "public"."chapter_import_item_status" AS ENUM('pending', 'uploading', 'uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
DROP INDEX "uploads_active_chapter_unique";--> statement-breakpoint
ALTER TABLE "chapter_import_items" ADD COLUMN "filename" varchar(255);--> statement-breakpoint
ALTER TABLE "chapter_import_items" ADD COLUMN "status" "chapter_import_item_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
UPDATE "chapter_import_items" AS item
SET "filename" = COALESCE(
  (
    SELECT upload."original_filename"
    FROM "uploads" AS upload
    WHERE upload."id" = item."upload_id"
  ),
  item."client_id" || '.zip'
);--> statement-breakpoint
UPDATE "chapter_import_items" AS item
SET "status" = CASE
  WHEN item."error_code" IS NOT NULL THEN 'failed'::"chapter_import_item_status"
  WHEN item."chapter_id" IS NULL THEN 'failed'::"chapter_import_item_status"
  ELSE COALESCE(
    (
      SELECT CASE chapter."status"
        WHEN 'draft' THEN 'pending'::"chapter_import_item_status"
        ELSE chapter."status"::text::"chapter_import_item_status"
      END
      FROM "chapters" AS chapter
      WHERE chapter."id" = item."chapter_id"
    ),
    'failed'::"chapter_import_item_status"
  )
END;--> statement-breakpoint
ALTER TABLE "chapter_import_items" ALTER COLUMN "filename" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_active_chapter_unique" ON "uploads" USING btree ("chapter_id") WHERE "uploads"."status" <> 'uploaded';
