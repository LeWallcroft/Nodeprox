ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "display_name" varchar(120),
  ADD COLUMN IF NOT EXISTS "avatar_url" text,
  ADD COLUMN IF NOT EXISTS "preferences" jsonb;

CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
  "id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_token_hash_unique"
  ON "password_reset_tokens" USING btree ("token_hash");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_user_id_idx"
  ON "password_reset_tokens" USING btree ("user_id");
CREATE INDEX IF NOT EXISTS "password_reset_tokens_expires_at_idx"
  ON "password_reset_tokens" USING btree ("expires_at");
