ALTER TABLE "sessions" ALTER COLUMN "metadata" SET DATA TYPE jsonb USING metadata::jsonb;
