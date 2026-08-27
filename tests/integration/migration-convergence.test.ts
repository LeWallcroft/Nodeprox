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
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase } from "../../database/client.js";

const infrastructure = inject("infrastructure");
const freshName = `nodeprox_fresh_${randomUUID().replaceAll("-", "")}`;
const upgradeName = `nodeprox_upgrade_${randomUUID().replaceAll("-", "")}`;
const partialHotfixName = `nodeprox_partial_${randomUUID().replaceAll("-", "")}`;
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
});

afterAll(async () => {
  await dropDatabaseNamed(freshName);
  await dropDatabaseNamed(upgradeName);
  await dropDatabaseNamed(partialHotfixName);
  await admin.end();
});

describe("convergent migration sequence", () => {
  it("migrates an empty database through A1 and upload transfer", async () => {
    const database = createDatabase(databaseUrl(freshName));
    try {
      await migrate(database.db, { migrationsFolder: "database/migrations" });
      const tables = await database.sql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('series_assignments', 'uploads')
        ORDER BY table_name
      `;
      expect(tables.map((row) => row.table_name)).toEqual([
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
    } finally {
      await database.sql.end();
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

      let violationCode: string | undefined;
      try {
        await database.sql`
          INSERT INTO uploads (
            id, chapter_id, storage_key, original_filename, content_type,
            size_bytes, status, created_by
          ) VALUES (
            ${randomUUID()}, ${invalidChapterId}, ${`new/${invalidChapterId}.zip`},
            'invalid.zip', 'application/zip', 0, 'pending', ${userId}
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
