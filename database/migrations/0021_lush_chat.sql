CREATE TYPE "public"."media_effect_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."media_effect_type" AS ENUM('cdn_purge', 'storage_delete');--> statement-breakpoint
CREATE TABLE "image_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"image_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"physical_filename" varchar(255) NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"extension" varchar(10) NOT NULL,
	"content_type" varchar(128) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "image_versions_version_positive" CHECK ("image_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "media_effect_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"replacement_operation_id" uuid NOT NULL,
	"effect_type" "media_effect_type" NOT NULL,
	"image_id" uuid NOT NULL,
	"target" text NOT NULL,
	"status" "media_effect_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "current_version_id" uuid;--> statement-breakpoint
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "image_versions_image_version_unique" ON "image_versions" USING btree ("image_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "image_versions_storage_key_unique" ON "image_versions" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "image_versions_image_idx" ON "image_versions" USING btree ("image_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_effect_outbox_operation_effect_target_unique" ON "media_effect_outbox" USING btree ("replacement_operation_id","effect_type","target");--> statement-breakpoint
CREATE INDEX "media_effect_outbox_pending_idx" ON "media_effect_outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "media_effect_outbox_image_idx" ON "media_effect_outbox" USING btree ("image_id");--> statement-breakpoint
INSERT INTO "image_versions" (
	"image_id",
	"version",
	"physical_filename",
	"storage_key",
	"extension",
	"content_type",
	"size_bytes",
	"checksum",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	1,
	"filename",
	"storage_key",
	"extension",
	"content_type",
	"size_bytes",
	"checksum",
	"created_at",
	"updated_at"
FROM "images";--> statement-breakpoint
UPDATE "images"
SET "current_version_id" = "image_versions"."id"
FROM "image_versions"
WHERE "image_versions"."image_id" = "images"."id"
	AND "image_versions"."version" = 1;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "images" WHERE "current_version_id" IS NULL) THEN
		RAISE EXCEPTION 'image version backfill incomplete';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "current_version_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_current_version_id_image_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."image_versions"("id") ON DELETE restrict ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;
