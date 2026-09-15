DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "series"
    WHERE "id" = 'bd2357e8-2456-4ff4-9a5b-81d88b1d4e6a'
      AND "discord_channel_id" = '1485453020790784134'
  ) THEN
    RAISE EXCEPTION 'BOT-M2.1 reconciliation precondition failed for Series A';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "series"
    WHERE "id" = 'a67c4575-4912-42b2-8f29-b09f0433fd43'
      AND "discord_channel_id" = '1485453020790784134'
  ) THEN
    RAISE EXCEPTION 'BOT-M2.1 reconciliation precondition failed for Series B';
  END IF;
END $$;
--> statement-breakpoint
UPDATE "series"
SET
  "discord_channel_id" = NULL,
  "discord_channel_name_snapshot" = NULL
WHERE "id" = 'bd2357e8-2456-4ff4-9a5b-81d88b1d4e6a'
  AND "discord_channel_id" = '1485453020790784134';
--> statement-breakpoint
CREATE UNIQUE INDEX "series_discord_channel_id_unique"
  ON "series" USING btree ("discord_channel_id")
  WHERE "discord_channel_id" IS NOT NULL;
