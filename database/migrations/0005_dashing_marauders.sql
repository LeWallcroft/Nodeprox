CREATE TYPE "public"."chapter_status" AS ENUM('draft', 'uploading', 'uploaded', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(200) NOT NULL,
	"slug" varchar(220) NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_permissions" DROP CONSTRAINT "chapter_permissions_permission_check";--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "chapter_number" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "chapters" ADD COLUMN "status" "chapter_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "series_slug_unique" ON "series" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "series_created_by_idx" ON "series" USING btree ("created_by");--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_series_number_unique" ON "chapters" USING btree ("series_id","chapter_number");--> statement-breakpoint
ALTER TABLE "chapter_permissions" ADD CONSTRAINT "chapter_permissions_permission_check" CHECK ("chapter_permissions"."permission" in ('chapters.read', 'chapters.edit', 'chapters.replace', 'images.upload', 'images.replace', 'images.reorder', 'images.delete'));--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_number_positive" CHECK ("chapters"."chapter_number" > 0);