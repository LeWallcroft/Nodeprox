DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "series" AS s
    LEFT JOIN "series_assignments" AS sa ON sa."series_id" = s."id"
    LEFT JOIN "users" AS u ON u."id" = s."created_by"
    WHERE sa."id" IS NULL
      AND (u."id" IS NULL OR u."status" <> 'active')
  ) THEN
    RAISE EXCEPTION
      'Cannot backfill Series responsibility: an unassigned Series has no active creator.';
  END IF;
END $$;
--> statement-breakpoint
INSERT INTO "series_assignments" ("series_id", "uploader_id", "assigned_by")
SELECT s."id", s."created_by", s."created_by"
FROM "series" AS s
LEFT JOIN "series_assignments" AS sa ON sa."series_id" = s."id"
WHERE sa."id" IS NULL;
--> statement-breakpoint
ALTER TABLE "series_assignments" RENAME COLUMN "uploader_id" TO "responsible_user_id";
--> statement-breakpoint
ALTER TABLE "series_assignments"
  RENAME CONSTRAINT "series_assignments_uploader_id_users_id_fk"
  TO "series_assignments_responsible_user_id_users_id_fk";
--> statement-breakpoint
ALTER INDEX "series_assignments_uploader_idx"
  RENAME TO "series_assignments_responsible_user_idx";
