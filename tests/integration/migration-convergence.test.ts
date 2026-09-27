import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase } from "../../database/client.js";

const infrastructure = inject("infrastructure");
const freshName = `nodeprox_fresh_${randomUUID().replaceAll("-", "")}`;
const upgradeName = `nodeprox_upgrade_${randomUUID().replaceAll("-", "")}`;
const partialHotfixName = `nodeprox_partial_${randomUUID().replaceAll("-", "")}`;
const knownDuplicateName = `nodeprox_known_duplicate_${randomUUID().replaceAll("-", "")}`;
const unexpectedDuplicateName = `nodeprox_unexpected_duplicate_${randomUUID().replaceAll("-", "")}`;
const multipleDuplicatesName = `nodeprox_multiple_duplicates_${randomUUID().replaceAll("-", "")}`;
const grantProvenanceName = `nodeprox_grant_provenance_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(infrastructure.databaseUrl, { max: 1 });

function databaseUrl(name: string): string {
  const value = new URL(infrastructure.databaseUrl);
  value.pathname = `/${name}`;
  return value.toString();
}

async function createDatabaseNamed(name: string): Promise<void> {
  await admin`CREATE DATABASE ${admin(name)}`;
}

async function dropDatabaseNamed(name: string): Promise<void> {
  await admin`DROP DATABASE IF EXISTS ${admin(name)} WITH (FORCE)`;
}

async function migrationsThrough(maxIndex: number): Promise<string> {
  const source = join(process.cwd(), "database", "migrations");
  const target = await mkdtemp(join(tmpdir(), "nodeprox-a1-migrations-"));
  const meta = join(target, "meta");
  await mkdir(meta);
  const journal = JSON.parse(
    await readFile(join(source, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entries = journal.entries.filter((entry) => entry.idx <= maxIndex);
  await writeFile(
    join(meta, "_journal.json"),
    `${JSON.stringify({ ...journal, entries }, null, 2)}\n`,
  );
  await Promise.all(
    entries.map((entry) =>
      copyFile(
        join(source, `${entry.tag}.sql`),
        join(target, `${entry.tag}.sql`),
      ),
    ),
  );
  return target;
}

beforeAll(async () => {
  await createDatabaseNamed(freshName);
  await createDatabaseNamed(upgradeName);
  await createDatabaseNamed(partialHotfixName);
  await createDatabaseNamed(knownDuplicateName);
  await createDatabaseNamed(unexpectedDuplicateName);
  await createDatabaseNamed(multipleDuplicatesName);
  await createDatabaseNamed(grantProvenanceName);
});

afterAll(async () => {
  await dropDatabaseNamed(freshName);
  await dropDatabaseNamed(upgradeName);
  await dropDatabaseNamed(partialHotfixName);
  await dropDatabaseNamed(knownDuplicateName);
  await dropDatabaseNamed(unexpectedDuplicateName);
  await dropDatabaseNamed(multipleDuplicatesName);
  await dropDatabaseNamed(grantProvenanceName);
  await admin.end();
});

describe("convergent migration sequence", () => {
  it("backfills Discord grant provenance and enforces Web/Discord source constraints", async () => {
    const database = createDatabase(databaseUrl(grantProvenanceName));
    const subset = await migrationsThrough(30);
    const targetUserId = randomUUID();
    const actorUserId = randomUUID();
    try {
      await migrate(database.db, { migrationsFolder: subset });
      await database.sql`
        INSERT INTO users (id, email, password_hash, status, role) VALUES
          (${targetUserId}, ${`grant-target-${targetUserId}@example.com`}, 'hash', 'active', 'uploader'),
          (${actorUserId}, ${`grant-actor-${actorUserId}@example.com`}, 'hash', 'active', 'admin')
      `;
      const legacyGrantId = randomUUID();
      await database.sql`
        INSERT INTO series_creation_grants (
          id, display_code, target_user_id, issued_by_discord_id,
          issued_from_channel_id, issued_interaction_id
        ) VALUES (${legacyGrantId}, 'NPX-LEGACY', ${targetUserId}, 'discord-user', 'discord-channel', 'discord-interaction')
      `;
      await migrate(database.db, { migrationsFolder: "database/migrations" });
      const [legacy] = await database.sql<
        { issuedVia: string; issuedByUserId: string | null }[]
      >`
        SELECT issued_via AS "issuedVia", issued_by_user_id AS "issuedByUserId"
        FROM series_creation_grants WHERE id = ${legacyGrantId}
      `;
      expect(legacy).toEqual({ issuedVia: "discord", issuedByUserId: null });
      await database.sql`
        INSERT INTO series_creation_grants (
          id, display_code, target_user_id, issued_via, issued_by_user_id
        ) VALUES (${randomUUID()}, 'NPX-WEB', ${targetUserId}, 'web', ${actorUserId})
      `;
      await expect(database.sql`
        INSERT INTO series_creation_grants (id, display_code, target_user_id, issued_via)
        VALUES (${randomUUID()}, 'NPX-WEB-BAD', ${targetUserId}, 'web')
      `).rejects.toMatchObject({ code: "23514" });
      await expect(database.sql`
        INSERT INTO series_creation_grants (id, display_code, target_user_id, issued_via, issued_by_discord_id)
        VALUES (${randomUUID()}, 'NPX-DISCORD-BAD', ${targetUserId}, 'discord', 'discord-user')
      `).rejects.toMatchObject({ code: "23514" });
    } finally {
      await database.sql.end();
      await rm(subset, { recursive: true, force: true });
    }
  });
  it("migrates an empty database through A1 and upload transfer", async () => {
    const database = createDatabase(databaseUrl(freshName));
    try {
      await migrate(database.db, { migrationsFolder: "database/migrations" });
      const tables = await database.sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'chapter_deletion_outbox',
            'chapter_import_batches',
            'chapter_import_items',
            'helper_series_cooldowns',
            'series_assignments',
            'uploads'
          )
        ORDER BY table_name
      `;
      expect(tables.map((row) => row.table_name)).toEqual([
        "chapter_deletion_outbox",
        "chapter_import_batches",
        "chapter_import_items",
        "helper_series_cooldowns",
        "series_assignments",
        "uploads",
      ]);
      const statuses = await database.sql<{ enumlabel: string }[]>`
        SELECT enumlabel
        FROM pg_enum
        JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
        WHERE pg_type.typname = 'upload_status'
        ORDER BY enumsortorder
      `;
      expect(statuses.map((row) => row.enumlabel)).toEqual([
        "pending",
        "verifying",
        "aborting",
        "uploaded",
      ]);
      const itemStatuses = await database.sql<{ enumlabel: string }[]>`
        SELECT enumlabel
        FROM pg_enum
        JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
        WHERE pg_type.typname = 'chapter_import_item_status'
        ORDER BY enumsortorder
      `;
      expect(itemStatuses.map((row) => row.enumlabel)).toEqual([
        "pending",
        "uploading",
        "uploaded",
        "processing",
        "ready",
        "failed",
      ]);
      const chapterStatuses = await database.sql<{ enumlabel: string }[]>`
        SELECT enumlabel
        FROM pg_enum
        JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
        WHERE pg_type.typname = 'chapter_status'
        ORDER BY enumsortorder
      `;
      expect(chapterStatuses.map((row) => row.enumlabel)).toContain("deleting");
      const itemColumns = await database.sql<
        {
          column_name: string;
          is_nullable: string;
        }[]
      >`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'chapter_import_items'
          AND column_name IN ('filename', 'status', 'upload_id', 'error_code')
        ORDER BY column_name
      `;
      expect(itemColumns).toEqual([
        { column_name: "error_code", is_nullable: "YES" },
        { column_name: "filename", is_nullable: "NO" },
        { column_name: "status", is_nullable: "NO" },
        { column_name: "upload_id", is_nullable: "YES" },
      ]);
      const [activeUploadIndex] = await database.sql<
        {
          definition: string;
        }[]
      >`
        SELECT indexdef AS definition
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = 'uploads_active_chapter_unique'
      `;
      expect(activeUploadIndex?.definition).toContain("WHERE");
      expect(activeUploadIndex?.definition).toContain("uploaded");
      const [seriesChannelIndex] = await database.sql<
        { name: string | null }[]
      >`
        SELECT to_regclass('public.series_discord_channel_id_unique')::text AS name
      `;
      expect(seriesChannelIndex?.name).toBe("series_discord_channel_id_unique");
    } finally {
      await database.sql.end();
    }
  });

  it("reconciles only the approved historical Discord channel duplicate", async () => {
    const database = createDatabase(databaseUrl(knownDuplicateName));
    const subset = await migrationsThrough(29);
    const userId = randomUUID();
    const channelId = "1485453020790784134";
    try {
      await migrate(database.db, { migrationsFolder: subset });
      await database.sql`
        INSERT INTO users (id, email, password_hash, status, role)
        VALUES (${userId}, ${`migration-known-${userId}@example.com`}, 'not-a-real-hash', 'active', 'gestor')
      `;
      await database.sql`
        INSERT INTO series (
          id, title, slug, created_by, discord_channel_id, discord_channel_name_snapshot
        ) VALUES
          ('bd2357e8-2456-4ff4-9a5b-81d88b1d4e6a', 'Historical A', 'historical-a', ${userId}, ${channelId}, 'una-delicia-inesperada'),
          ('a67c4575-4912-42b2-8f29-b09f0433fd43', 'Historical B', 'historical-b', ${userId}, ${channelId}, 'una-delicia-inesperada')
      `;

      await migrate(database.db, { migrationsFolder: "database/migrations" });

      const rows = await database.sql<
        { id: string; channelId: string | null; channelName: string | null }[]
      >`
        SELECT
          id,
          discord_channel_id AS "channelId",
          discord_channel_name_snapshot AS "channelName"
        FROM series
        WHERE id IN (
          'bd2357e8-2456-4ff4-9a5b-81d88b1d4e6a',
          'a67c4575-4912-42b2-8f29-b09f0433fd43'
        )
        ORDER BY id
      `;
      expect(rows).toEqual([
        {
          id: "a67c4575-4912-42b2-8f29-b09f0433fd43",
          channelId,
          channelName: "una-delicia-inesperada",
        },
        {
          id: "bd2357e8-2456-4ff4-9a5b-81d88b1d4e6a",
          channelId: null,
          channelName: null,
        },
      ]);
      const [seriesChannelIndex] = await database.sql<
        { name: string | null }[]
      >`
        SELECT to_regclass('public.series_discord_channel_id_unique')::text AS name
      `;
      expect(seriesChannelIndex?.name).toBe("series_discord_channel_id_unique");
    } finally {
      await database.sql.end();
      await rm(subset, { recursive: true, force: true });
    }
  });

  it("rejects unexpected and multiple Discord channel duplicate groups", async () => {
    const names = [unexpectedDuplicateName, multipleDuplicatesName];
    for (const [index, name] of names.entries()) {
      const database = createDatabase(databaseUrl(name));
      const subset = await migrationsThrough(29);
      const userId = randomUUID();
      try {
        await migrate(database.db, { migrationsFolder: subset });
        await database.sql`
          INSERT INTO users (id, email, password_hash, status, role)
          VALUES (${userId}, ${`migration-unexpected-${userId}@example.com`}, 'not-a-real-hash', 'active', 'gestor')
        `;
        const firstSeriesId = randomUUID();
        const secondSeriesId = randomUUID();
        await database.sql`
          INSERT INTO series (id, title, slug, created_by, discord_channel_id)
          VALUES
            (${firstSeriesId}, 'Unexpected One', ${`unexpected-one-${firstSeriesId}`}, ${userId}, 'unexpected-channel-a'),
            (${secondSeriesId}, 'Unexpected Two', ${`unexpected-two-${secondSeriesId}`}, ${userId}, 'unexpected-channel-a')
        `;
        if (index === 1) {
          const thirdSeriesId = randomUUID();
          const fourthSeriesId = randomUUID();
          await database.sql`
            INSERT INTO series (id, title, slug, created_by, discord_channel_id)
            VALUES
              (${thirdSeriesId}, 'Unexpected Three', ${`unexpected-three-${thirdSeriesId}`}, ${userId}, 'unexpected-channel-b'),
              (${fourthSeriesId}, 'Unexpected Four', ${`unexpected-four-${fourthSeriesId}`}, ${userId}, 'unexpected-channel-b')
          `;
        }

        await expect(
          migrate(database.db, { migrationsFolder: "database/migrations" }),
        ).rejects.toThrow("unexpected duplicate bindings");
        const [seriesChannelIndex] = await database.sql<
          { name: string | null }[]
        >`
          SELECT to_regclass('public.series_discord_channel_id_unique')::text AS name
        `;
        expect(seriesChannelIndex?.name).toBeNull();
      } finally {
        await database.sql.end();
        await rm(subset, { recursive: true, force: true });
      }
    }
  });

  it("upgrades A1 while preserving legacy rows and protecting new writes", async () => {
    const database = createDatabase(databaseUrl(upgradeName));
    const subset = await migrationsThrough(9);
    const userId = randomUUID();
    const seriesId = randomUUID();
    const pendingChapterId = randomUUID();
    const uploadedChapterId = randomUUID();
    const invalidChapterId = randomUUID();
    try {
      await migrate(database.db, { migrationsFolder: subset });
      await database.sql`
        INSERT INTO users (id, email, password_hash, status, role)
        VALUES (${userId}, ${`migration-${userId}@example.com`}, 'not-a-real-hash', 'active', 'gestor')
      `;
      await database.sql`
        INSERT INTO series (id, title, slug, created_by)
        VALUES (${seriesId}, 'Migration Series', ${`migration-${seriesId}`}, ${userId})
      `;
      await database.sql`
        INSERT INTO chapters (id, series_id, chapter_number, status, created_by)
        VALUES
          (${pendingChapterId}, ${seriesId}, 1, 'uploading', ${userId}),
          (${uploadedChapterId}, ${seriesId}, 2, 'uploaded', ${userId}),
          (${invalidChapterId}, ${seriesId}, 3, 'uploading', ${userId})
      `;
      await database.sql`
        INSERT INTO uploads (
          id, chapter_id, storage_key, original_filename, content_type,
          size_bytes, status, created_by
        ) VALUES
          (${randomUUID()}, ${pendingChapterId}, ${`legacy/${pendingChapterId}.zip`}, 'pending.zip', 'application/zip', 0, 'pending', ${userId}),
          (${randomUUID()}, ${uploadedChapterId}, ${`legacy/${uploadedChapterId}.zip`}, 'uploaded.zip', 'application/zip', 0, 'uploaded', ${userId})
      `;

      await migrate(database.db, { migrationsFolder: "database/migrations" });

      const [constraint] = await database.sql<{ convalidated: boolean }[]>`
        SELECT convalidated
        FROM pg_constraint
        WHERE conname = 'uploads_size_positive'
      `;
      expect(constraint?.convalidated).toBe(false);
      const [legacy] = await database.sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM uploads
        WHERE size_bytes <= 0
      `;
      expect(legacy?.count).toBe("2");
      const [legacyProfile] = await database.sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM uploads
        WHERE size_bytes <= 0
          AND storage_profile_id = '00000000-0000-4000-8000-000000000001'
      `;
      expect(legacyProfile?.count).toBe("2");
      const [profileDefault] = await database.sql<
        { column_default: string | null }[]
      >`
        SELECT column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'uploads'
          AND column_name = 'storage_profile_id'
      `;
      expect(profileDefault?.column_default).toBeNull();

      let violationCode: string | undefined;
      try {
        await database.sql`
          INSERT INTO uploads (
            id, chapter_id, storage_key, storage_profile_id, original_filename, content_type,
            size_bytes, status, created_by
          ) VALUES (
            ${randomUUID()}, ${invalidChapterId}, ${`new/${invalidChapterId}.zip`},
            '00000000-0000-4000-8000-000000000001', 'invalid.zip', 'application/zip', 0, 'pending', ${userId}
          )
        `;
      } catch (error) {
        violationCode =
          typeof error === "object" && error && "code" in error
            ? String(error.code)
            : undefined;
      }
      expect(violationCode).toBe("23514");
    } finally {
      await database.sql.end();
      await rm(subset, { recursive: true, force: true });
    }
  });

  it("repairs a database that ran the unpublished upload 0009 before A1", async () => {
    const database = createDatabase(databaseUrl(partialHotfixName));
    const subset = await migrationsThrough(8);
    try {
      await migrate(database.db, { migrationsFolder: subset });
      await database.sql.unsafe(`
        ALTER TYPE "public"."upload_status" ADD VALUE 'verifying' BEFORE 'uploaded';
        ALTER TYPE "public"."upload_status" ADD VALUE 'aborting' BEFORE 'uploaded';
        ALTER TABLE "uploads" ADD CONSTRAINT "uploads_size_positive"
          CHECK ("uploads"."size_bytes" > 0) NOT VALID;
      `);
      await database.sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES ('unpublished-upload-0009', 1787730562332)
      `;

      await migrate(database.db, { migrationsFolder: "database/migrations" });

      const [assignmentTable] = await database.sql<{ name: string | null }[]>`
        SELECT to_regclass('public.series_assignments')::text AS name
      `;
      expect(assignmentTable?.name).toBe("series_assignments");
      const statuses = await database.sql<{ enumlabel: string }[]>`
        SELECT enumlabel
        FROM pg_enum
        JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
        WHERE pg_type.typname = 'upload_status'
        ORDER BY enumsortorder
      `;
      expect(statuses.map((row) => row.enumlabel)).toEqual([
        "pending",
        "verifying",
        "aborting",
        "uploaded",
      ]);
      const [constraint] = await database.sql<
        { convalidated: boolean; definition: string }[]
      >`
        SELECT convalidated, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname = 'uploads_size_positive'
      `;
      expect(constraint).toMatchObject({
        convalidated: false,
        definition: expect.stringContaining("size_bytes > 0"),
      });
    } finally {
      await database.sql.end();
      await rm(subset, { recursive: true, force: true });
    }
  });
});
