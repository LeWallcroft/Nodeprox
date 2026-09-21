DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "series"
    WHERE "discord_channel_id" IS NOT NULL
    GROUP BY "discord_channel_id"
    HAVING COUNT(*) > 1
  ) THEN
    IF (
      SELECT COUNT(*)
      FROM "series"
      WHERE "discord_channel_id" = '1485453020790784134'
        AND "id" IN (
          'bd2357e8-2456-4ff4-9a5b-81d88b1d4e6a',
          'a67c4575-4912-42b2-8f29-b09f0433fd43'
        )
    ) = 2
    AND (
      SELECT COUNT(*)
      FROM "series"
      WHERE "discord_channel_id" = '1485453020790784134'
    ) = 2
    AND NOT EXISTS (
      SELECT 1
      FROM "series"
      WHERE "discord_channel_id" IS NOT NULL
      GROUP BY "discord_channel_id"
      HAVING COUNT(*) > 1
        AND "discord_channel_id" <> '1485453020790784134'
    ) THEN
      UPDATE "series"
      SET
        "discord_channel_id" = NULL,
        "discord_channel_name_snapshot" = NULL
      WHERE "id" = 'bd2357e8-2456-4ff4-9a5b-81d88b1d4e6a'
        AND "discord_channel_id" = '1485453020790784134';
    ELSE
      RAISE EXCEPTION
        'Series Discord channel reconciliation found unexpected duplicate bindings';
    END IF;
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "series"
    WHERE "discord_channel_id" IS NOT NULL
    GROUP BY "discord_channel_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Series Discord channel reconciliation left duplicate bindings';
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "series_discord_channel_id_unique"
  ON "series" USING btree ("discord_channel_id")
  WHERE "discord_channel_id" IS NOT NULL;
