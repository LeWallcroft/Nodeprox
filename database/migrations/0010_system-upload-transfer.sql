-- Convergence bridge for environments that executed the unpublished upload
-- 0009 before A1 became the canonical 0009 in the integrated history.
CREATE TABLE IF NOT EXISTS "series_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"uploader_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'series_assignments_series_id_series_id_fk'
			AND conrelid = 'series_assignments'::regclass
	) THEN
		ALTER TABLE "series_assignments"
			ADD CONSTRAINT "series_assignments_series_id_series_id_fk"
			FOREIGN KEY ("series_id") REFERENCES "public"."series"("id")
			ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'series_assignments_uploader_id_users_id_fk'
			AND conrelid = 'series_assignments'::regclass
	) THEN
		ALTER TABLE "series_assignments"
			ADD CONSTRAINT "series_assignments_uploader_id_users_id_fk"
			FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'series_assignments_assigned_by_users_id_fk'
			AND conrelid = 'series_assignments'::regclass
	) THEN
		ALTER TABLE "series_assignments"
			ADD CONSTRAINT "series_assignments_assigned_by_users_id_fk"
			FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id")
			ON DELETE restrict ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "series_assignments_series_unique"
	ON "series_assignments" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "series_assignments_uploader_idx"
	ON "series_assignments" USING btree ("uploader_id");--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_status_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check"
	CHECK ("users"."status" in ('pending', 'active', 'rejected', 'suspended', 'disabled'));--> statement-breakpoint
ALTER TYPE "public"."upload_status" ADD VALUE IF NOT EXISTS 'verifying' BEFORE 'uploaded';--> statement-breakpoint
ALTER TYPE "public"."upload_status" ADD VALUE IF NOT EXISTS 'aborting' BEFORE 'uploaded';--> statement-breakpoint
-- New writes are checked immediately; legacy rows are diagnosed and repaired
-- before the explicit VALIDATE CONSTRAINT maintenance step.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint
		WHERE conname = 'uploads_size_positive'
			AND conrelid = 'uploads'::regclass
	) THEN
		ALTER TABLE "uploads" ADD CONSTRAINT "uploads_size_positive"
			CHECK ("uploads"."size_bytes" > 0) NOT VALID;
	END IF;
END $$;
