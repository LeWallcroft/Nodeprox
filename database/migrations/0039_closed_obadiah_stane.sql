ALTER TABLE "chapter_processing_attempts" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "chapter_processing_objects" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "chapter_replacement_items" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "image_replacement_operations" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "image_versions" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "media_effect_outbox" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "storage_cleanup_outbox" ADD COLUMN "storage_profile_id" uuid;--> statement-breakpoint
ALTER TABLE "uploads" ADD COLUMN "storage_profile_id" uuid DEFAULT '00000000-0000-4000-8000-000000000001';--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage_profiles WHERE id = '00000000-0000-4000-8000-000000000001' AND provider = 'b2' AND source = 'env' AND status = 'active' AND public_hostname = 'media.nodeprox.org') THEN
    RAISE EXCEPTION 'legacy-storage-profile-invariant';
  END IF;
END $$;--> statement-breakpoint
UPDATE "processing_outbox" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "chapter_processing_attempts" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "chapter_processing_objects" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "chapter_replacement_operations" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "chapter_replacement_items" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "image_replacement_operations" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "image_versions" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "images" AS i SET "storage_profile_id" = v."storage_profile_id" FROM "image_versions" AS v WHERE i."current_version_id" = v."id" AND i."storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "storage_cleanup_outbox" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
UPDATE "media_effect_outbox" SET "storage_profile_id" = '00000000-0000-4000-8000-000000000001' WHERE "storage_profile_id" IS NULL;--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "images" AS i LEFT JOIN "image_versions" AS v ON v.id = i.current_version_id WHERE i.storage_profile_id IS DISTINCT FROM v.storage_profile_id)
     OR EXISTS (SELECT 1 FROM "uploads" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "processing_outbox" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "chapter_processing_attempts" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "chapter_processing_objects" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "chapter_replacement_operations" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "chapter_replacement_items" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "image_replacement_operations" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "image_versions" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "storage_cleanup_outbox" WHERE storage_profile_id IS NULL)
     OR EXISTS (SELECT 1 FROM "media_effect_outbox" WHERE storage_profile_id IS NULL) THEN
    RAISE EXCEPTION 'storage-profile-backfill-incomplete';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "storage_profile_id" DROP DEFAULT;--> statement-breakpoint
SET CONSTRAINTS ALL IMMEDIATE;--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_processing_objects" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_replacement_items" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "image_replacement_operations" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "image_versions" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "images" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_effect_outbox" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_outbox" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "storage_cleanup_outbox" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "uploads" ALTER COLUMN "storage_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_processing_attempts" ADD CONSTRAINT "chapter_processing_attempts_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_processing_objects" ADD CONSTRAINT "chapter_processing_objects_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_replacement_items" ADD CONSTRAINT "chapter_replacement_items_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_replacement_operations" ADD CONSTRAINT "chapter_replacement_operations_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_replacement_operations" ADD CONSTRAINT "image_replacement_operations_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_versions" ADD CONSTRAINT "image_versions_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_effect_outbox" ADD CONSTRAINT "media_effect_outbox_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_outbox" ADD CONSTRAINT "processing_outbox_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_cleanup_outbox" ADD CONSTRAINT "storage_cleanup_outbox_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_storage_profile_id_storage_profiles_id_fk" FOREIGN KEY ("storage_profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_processing_object_profile_idx" ON "chapter_processing_objects" USING btree ("storage_profile_id");--> statement-breakpoint
CREATE INDEX "image_versions_storage_profile_id_idx" ON "image_versions" USING btree ("storage_profile_id");--> statement-breakpoint
CREATE INDEX "images_storage_profile_id_idx" ON "images" USING btree ("storage_profile_id");--> statement-breakpoint
CREATE INDEX "media_effect_outbox_profile_idx" ON "media_effect_outbox" USING btree ("storage_profile_id");--> statement-breakpoint
CREATE INDEX "storage_cleanup_outbox_profile_idx" ON "storage_cleanup_outbox" USING btree ("storage_profile_id");--> statement-breakpoint
CREATE INDEX "uploads_storage_profile_id_idx" ON "uploads" USING btree ("storage_profile_id");
