CREATE TYPE "public"."storage_profile_check_status" AS ENUM('pending', 'checking', 'verified', 'manual_required', 'failed');--> statement-breakpoint
CREATE TYPE "public"."storage_profile_check_type" AS ENUM('b2_credentials', 'b2_bucket', 'b2_cors', 'b2_lifecycle', 'b2_storage_probe', 'b2_browser_upload', 'cloudflare_dns', 'cloudflare_transform', 'cloudflare_cache', 'cloudflare_delivery');--> statement-breakpoint
CREATE TABLE "storage_profile_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"check_type" "storage_profile_check_type" NOT NULL,
	"status" "storage_profile_check_status" DEFAULT 'pending' NOT NULL,
	"last_error_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_profile_checks_verified_timestamp" CHECK ("storage_profile_checks"."status" <> 'verified' or "storage_profile_checks"."verified_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "storage_profile_probe_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"expected_sha256" text NOT NULL,
	"expected_size_bytes" integer NOT NULL,
	"content_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "storage_profiles" DROP CONSTRAINT "storage_profiles_env_active";--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD COLUMN "b2_bucket_id" text;--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD COLUMN "b2_download_host" text;--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD COLUMN "cache_rule_id" text;--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD COLUMN "cloudflare_provisioning_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD COLUMN "cloudflare_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "storage_profile_checks" ADD CONSTRAINT "storage_profile_checks_profile_id_storage_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_profile_probe_sessions" ADD CONSTRAINT "storage_profile_probe_sessions_profile_id_storage_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."storage_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "storage_profile_checks_profile_type_unique" ON "storage_profile_checks" USING btree ("profile_id","check_type");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_profiles_single_active" ON "storage_profiles" USING btree ("status") WHERE "storage_profiles"."status" = 'active';--> statement-breakpoint
ALTER TABLE "storage_profiles" ADD CONSTRAINT "storage_profiles_env_active" CHECK ("storage_profiles"."source" <> 'env' or "storage_profiles"."status" in ('active', 'retired'));