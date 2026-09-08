CREATE TYPE "public"."series_creation_grant_status" AS ENUM('available', 'reserved', 'consumed', 'invalidated');--> statement-breakpoint
CREATE TABLE "discord_authorized_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"integration_id" uuid NOT NULL,
	"role_id" text NOT NULL,
	"can_issue_series_grants" boolean DEFAULT false NOT NULL,
	"can_invalidate_series_grants" boolean DEFAULT false NOT NULL,
	"can_configure_bot" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"control_channel_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discord_interactions" (
	"interaction_id" text PRIMARY KEY NOT NULL,
	"interaction_type" text NOT NULL,
	"actor_discord_id" text NOT NULL,
	"guild_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"result" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_creation_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_code" text NOT NULL,
	"target_user_id" uuid NOT NULL,
	"reference" text,
	"status" "series_creation_grant_status" DEFAULT 'available' NOT NULL,
	"issued_by_discord_id" text NOT NULL,
	"issued_from_channel_id" text NOT NULL,
	"issued_interaction_id" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reserved_at" timestamp with time zone,
	"reserved_until" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"consumed_by_series_id" uuid,
	"invalidated_at" timestamp with time zone,
	"invalidated_by_discord_id" text,
	"invalidated_interaction_id" text
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_id" varchar(32);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "discord_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "discord_channel_id" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "discord_channel_name_snapshot" text;--> statement-breakpoint
ALTER TABLE "discord_authorized_roles" ADD CONSTRAINT "discord_authorized_roles_integration_id_discord_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."discord_integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_authorized_roles" ADD CONSTRAINT "discord_authorized_roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discord_integrations" ADD CONSTRAINT "discord_integrations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD CONSTRAINT "series_creation_grants_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD CONSTRAINT "series_creation_grants_consumed_by_series_id_series_id_fk" FOREIGN KEY ("consumed_by_series_id") REFERENCES "public"."series"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discord_authorized_roles_integration_role_unique" ON "discord_authorized_roles" USING btree ("integration_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discord_integrations_guild_id_unique" ON "discord_integrations" USING btree ("guild_id");--> statement-breakpoint
CREATE UNIQUE INDEX "series_creation_grants_display_code_unique" ON "series_creation_grants" USING btree ("display_code");--> statement-breakpoint
CREATE UNIQUE INDEX "series_creation_grants_issued_interaction_unique" ON "series_creation_grants" USING btree ("issued_interaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "series_creation_grants_consumed_by_series_unique" ON "series_creation_grants" USING btree ("consumed_by_series_id");--> statement-breakpoint
CREATE INDEX "series_creation_grants_target_status_idx" ON "series_creation_grants" USING btree ("target_user_id","status");--> statement-breakpoint
CREATE INDEX "series_creation_grants_status_issued_at_idx" ON "series_creation_grants" USING btree ("status","issued_at");--> statement-breakpoint
CREATE INDEX "series_creation_grants_issued_by_discord_id_idx" ON "series_creation_grants" USING btree ("issued_by_discord_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_discord_id_unique" ON "users" USING btree ("discord_id");