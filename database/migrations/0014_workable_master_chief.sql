ALTER TABLE "chapters" ADD COLUMN "public_key" varchar(64);--> statement-breakpoint
UPDATE "chapters" SET "public_key" = "chapter_number"::text WHERE "public_key" IS NULL;--> statement-breakpoint
ALTER TABLE "chapters" ALTER COLUMN "public_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_series_public_key_unique" ON "chapters" USING btree ("series_id","public_key");--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_public_key_url_safe" CHECK ("chapters"."public_key" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');
