CREATE TABLE "helper_series_cooldowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"helper_user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"source_chapter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_import_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"client_id" varchar(100) NOT NULL,
	"chapter_number" integer NOT NULL,
	"chapter_id" uuid,
	"upload_id" uuid,
	"error_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "images" ADD COLUMN "warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "helper_series_cooldowns" ADD CONSTRAINT "helper_series_cooldowns_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_series_cooldowns" ADD CONSTRAINT "helper_series_cooldowns_helper_user_id_users_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "helper_series_cooldowns" ADD CONSTRAINT "helper_series_cooldowns_source_chapter_id_chapters_id_fk" FOREIGN KEY ("source_chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_import_batches" ADD CONSTRAINT "chapter_import_batches_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_import_batches" ADD CONSTRAINT "chapter_import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_import_items" ADD CONSTRAINT "chapter_import_items_batch_id_chapter_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."chapter_import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_import_items" ADD CONSTRAINT "chapter_import_items_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_import_items" ADD CONSTRAINT "chapter_import_items_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "helper_series_cooldowns_scope_unique" ON "helper_series_cooldowns" USING btree ("series_id","helper_user_id");--> statement-breakpoint
CREATE INDEX "helper_series_cooldowns_expires_idx" ON "helper_series_cooldowns" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "chapter_import_batches_series_idx" ON "chapter_import_batches" USING btree ("series_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_import_items_client_unique" ON "chapter_import_items" USING btree ("batch_id","client_id");--> statement-breakpoint
CREATE INDEX "chapter_import_items_chapter_idx" ON "chapter_import_items" USING btree ("chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_import_items_upload_idx" ON "chapter_import_items" USING btree ("upload_id");