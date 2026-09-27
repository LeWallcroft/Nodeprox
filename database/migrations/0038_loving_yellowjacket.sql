CREATE TYPE "public"."cloudflare_provisioning_status" AS ENUM('pending', 'provisioning', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."storage_profile_provider" AS ENUM('b2');--> statement-breakpoint
CREATE TYPE "public"."storage_profile_source" AS ENUM('env', 'managed');--> statement-breakpoint
CREATE TYPE "public"."storage_profile_status" AS ENUM('draft', 'ready', 'active', 'retired');--> statement-breakpoint
CREATE TABLE "storage_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "storage_profile_provider" NOT NULL,
	"source" "storage_profile_source" NOT NULL,
	"status" "storage_profile_status" NOT NULL,
	"name" varchar(120) NOT NULL,
	"public_hostname_label" varchar(63) NOT NULL,
	"public_hostname" varchar(253) NOT NULL,
	"b2_endpoint" text,
	"b2_region" text,
	"b2_bucket" text,
	"b2_key_id" text,
	"encrypted_application_key" text,
	"credential_version" integer DEFAULT 0 NOT NULL,
	"dns_record_id" text,
	"transform_ruleset_id" text,
	"transform_rule_id" text,
	"cache_ruleset_id" text,
	"cloudflare_provisioning_version" integer DEFAULT 0 NOT NULL,
	"cloudflare_provisioning_status" "cloudflare_provisioning_status" DEFAULT 'pending' NOT NULL,
	"cloudflare_last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_profiles_legacy_secret_absent" CHECK ("storage_profiles"."source" <> 'env' or ("storage_profiles"."encrypted_application_key" is null and "storage_profiles"."b2_key_id" is null and "storage_profiles"."b2_bucket" is null and "storage_profiles"."b2_endpoint" is null and "storage_profiles"."b2_region" is null)),
	CONSTRAINT "storage_profiles_legacy_hostname_fixed" CHECK ("storage_profiles"."source" <> 'env' or ("storage_profiles"."public_hostname_label" = 'media' and "storage_profiles"."public_hostname" = 'media.nodeprox.org')),
	CONSTRAINT "storage_profiles_credential_version_nonnegative" CHECK ("storage_profiles"."credential_version" >= 0),
	CONSTRAINT "storage_profiles_env_version_zero" CHECK ("storage_profiles"."source" <> 'env' or "storage_profiles"."credential_version" = 0),
	CONSTRAINT "storage_profiles_env_active" CHECK ("storage_profiles"."source" <> 'env' or "storage_profiles"."status" = 'active')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "storage_profiles_public_hostname_unique" ON "storage_profiles" USING btree ("public_hostname");--> statement-breakpoint
CREATE UNIQUE INDEX "storage_profiles_hostname_label_unique" ON "storage_profiles" USING btree ("public_hostname_label");--> statement-breakpoint
INSERT INTO "storage_profiles" ("id", "provider", "source", "status", "name", "public_hostname_label", "public_hostname", "credential_version", "cloudflare_provisioning_status")
VALUES ('00000000-0000-4000-8000-000000000001', 'b2', 'env', 'active', 'Legacy environment', 'media', 'media.nodeprox.org', 0, 'verified')
ON CONFLICT ("id") DO NOTHING;
