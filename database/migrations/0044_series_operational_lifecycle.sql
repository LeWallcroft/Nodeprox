CREATE TYPE "public"."series_inactive_reason" AS ENUM('dropped', 'hiatus', 'completed', 'other');--> statement-breakpoint
CREATE TYPE "public"."series_operational_state" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."series_reactivation_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "series_operational_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"previous_state" "series_operational_state" NOT NULL,
	"next_state" "series_operational_state" NOT NULL,
	"inactive_reason" "series_inactive_reason",
	"inactive_reason_detail" text,
	"actor_user_id" uuid NOT NULL,
	"responsible_user_id_at_event" uuid,
	"responsible_label_snapshot" text,
	"source_request_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series_reactivation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"status" "series_reactivation_request_status" DEFAULT 'pending' NOT NULL,
	"request_note" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"resolution_note" text,
	CONSTRAINT "series_reactivation_review_consistent" CHECK (("series_reactivation_requests"."status" = 'pending' and "series_reactivation_requests"."reviewed_by" is null and "series_reactivation_requests"."reviewed_at" is null)
      or ("series_reactivation_requests"."status" <> 'pending' and "series_reactivation_requests"."reviewed_by" is not null and "series_reactivation_requests"."reviewed_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "series_creation_grants" DROP CONSTRAINT "series_creation_grants_consumed_by_series_id_series_id_fk";
--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "operational_state" "series_operational_state" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "inactive_reason" "series_inactive_reason";--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "inactive_reason_detail" text;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "state_changed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "series" ADD COLUMN "state_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "series_operational_history" ADD CONSTRAINT "series_operational_history_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_operational_history" ADD CONSTRAINT "series_operational_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_operational_history" ADD CONSTRAINT "series_operational_history_responsible_user_id_at_event_users_id_fk" FOREIGN KEY ("responsible_user_id_at_event") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_reactivation_requests" ADD CONSTRAINT "series_reactivation_requests_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_reactivation_requests" ADD CONSTRAINT "series_reactivation_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series_reactivation_requests" ADD CONSTRAINT "series_reactivation_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "series_operational_history_series_occurred_idx" ON "series_operational_history" USING btree ("series_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "series_operational_history_actor_idx" ON "series_operational_history" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "series_reactivation_one_pending_idx" ON "series_reactivation_requests" USING btree ("series_id") WHERE "series_reactivation_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "series_reactivation_series_idx" ON "series_reactivation_requests" USING btree ("series_id");--> statement-breakpoint
CREATE INDEX "series_reactivation_status_idx" ON "series_reactivation_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "series_reactivation_requested_idx" ON "series_reactivation_requests" USING btree ("requested_at");--> statement-breakpoint
ALTER TABLE "series_creation_grants" ADD CONSTRAINT "series_creation_grants_consumed_by_series_id_series_id_fk" FOREIGN KEY ("consumed_by_series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_state_changed_by_users_id_fk" FOREIGN KEY ("state_changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_operational_state_consistent" CHECK (("series"."operational_state" = 'active' and "series"."inactive_reason" is null and "series"."inactive_reason_detail" is null)
        or ("series"."operational_state" = 'inactive' and "series"."inactive_reason" is not null and
          ("series"."inactive_reason" <> 'other' or nullif(btrim("series"."inactive_reason_detail"), '') is not null)));