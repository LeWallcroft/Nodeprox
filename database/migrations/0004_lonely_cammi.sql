CREATE TABLE "chapter_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chapter_id" uuid NOT NULL,
	"helper_user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "chapter_permissions_permission_check" CHECK ("chapter_permissions"."permission" in ('chapters.read', 'chapters.edit', 'chapters.replace', 'images.upload', 'images.replace', 'images.reorder', 'images.delete'))
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chapter_permissions" ADD CONSTRAINT "chapter_permissions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_permissions" ADD CONSTRAINT "chapter_permissions_helper_user_id_users_id_fk" FOREIGN KEY ("helper_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_permissions" ADD CONSTRAINT "chapter_permissions_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_permissions" ADD CONSTRAINT "chapter_permissions_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_permissions_helper_chapter_idx" ON "chapter_permissions" USING btree ("helper_user_id","chapter_id");--> statement-breakpoint
CREATE INDEX "chapter_permissions_chapter_idx" ON "chapter_permissions" USING btree ("chapter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "chapter_permissions_active_unique" ON "chapter_permissions" USING btree ("chapter_id","helper_user_id","permission") WHERE "chapter_permissions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "chapters_series_id_idx" ON "chapters" USING btree ("series_id");
