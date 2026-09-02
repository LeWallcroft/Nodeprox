ALTER TABLE "chapters" DROP CONSTRAINT "chapters_number_positive";--> statement-breakpoint
ALTER TABLE "chapters" ALTER COLUMN "chapter_number" SET DATA TYPE numeric(10, 3);--> statement-breakpoint
ALTER TABLE "chapter_import_items" ALTER COLUMN "chapter_number" SET DATA TYPE numeric(10, 3);--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_number_non_negative" CHECK ("chapters"."chapter_number" >= 0);