CREATE TYPE "series_creation_grant_issue_source" AS ENUM ('discord', 'web');--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD COLUMN "issued_via" "series_creation_grant_issue_source" NOT NULL DEFAULT 'discord';--> statement-breakpoint
UPDATE "series_creation_grants" SET "issued_via" = 'discord';--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD COLUMN "issued_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD COLUMN "invalidated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ALTER COLUMN "issued_by_discord_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ALTER COLUMN "issued_from_channel_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ALTER COLUMN "issued_interaction_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD CONSTRAINT "series_creation_grants_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD CONSTRAINT "series_creation_grants_invalidated_by_user_id_users_id_fk" FOREIGN KEY ("invalidated_by_user_id") REFERENCES "users"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD CONSTRAINT "series_creation_grants_issue_source_check" CHECK (("issued_via" = 'discord' AND "issued_by_discord_id" IS NOT NULL AND "issued_from_channel_id" IS NOT NULL AND "issued_interaction_id" IS NOT NULL AND "issued_by_user_id" IS NULL) OR ("issued_via" = 'web' AND "issued_by_user_id" IS NOT NULL AND "issued_by_discord_id" IS NULL AND "issued_from_channel_id" IS NULL AND "issued_interaction_id" IS NULL));
