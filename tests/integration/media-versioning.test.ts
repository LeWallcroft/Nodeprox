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
import { DrizzleImageRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/image.repository.js";
import { DrizzleMediaReplacementRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/media-replacement.repository.js";

const infrastructure = inject("infrastructure");
const databaseName = `nodeprox_media_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(infrastructure.databaseUrl, { max: 1 });
const userId = randomUUID();
const seriesId = randomUUID();
const chapterId = randomUUID();
const imageId = randomUUID();
let database: ReturnType<typeof createDatabase>;

function databaseUrl(): string {
  const value = new URL(infrastructure.databaseUrl);
  value.pathname = `/${databaseName}`;
  return value.toString();
}

async function migrationsThrough(maxIndex: number): Promise<string> {
  const source = join(process.cwd(), "database", "migrations");
  const target = await mkdtemp(join(tmpdir(), "nodeprox-media-migrations-"));
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
  await admin`CREATE DATABASE ${admin(databaseName)}`;
  database = createDatabase(databaseUrl());
  const subset = await migrationsThrough(20);
  try {
    await migrate(database.db, { migrationsFolder: subset });
  } finally {
    await rm(subset, { recursive: true, force: true });
  }
  await database.sql`
    insert into users (id, email, password_hash, status, role)
    values (${userId}, ${`media-${userId}@example.test`}, 'test-hash', 'active', 'admin')
  `;
  await database.sql`
    insert into series (id, title, slug, created_by)
    values (${seriesId}, 'Media Series', 'media-series', ${userId})
  `;
  await database.sql`
    insert into chapters (id, series_id, chapter_number, public_key, status, created_by)
    values (${chapterId}, ${seriesId}, 1, '1', 'ready', ${userId})
  `;
  await database.sql`
    insert into images (
      id, chapter_id, filename, storage_key, extension, content_type,
      size_bytes, sort_order, checksum
    ) values (
      ${imageId}, ${chapterId}, '00.jpg', 'Media/media-series/1/00.jpg',
      'jpg', 'image/jpeg', 100, 0, 'historical-checksum'
    )
  `;
  await migrate(database.db, { migrationsFolder: "database/migrations" });
});

afterAll(async () => {
  await database.sql.end();
  await admin`DROP DATABASE IF EXISTS ${admin(databaseName)} WITH (FORCE)`;
  await admin.end();
});

describe("CASE-V1-MEDIA-01 persistence", () => {
  it("backfills exactly one unchanged v1 and assigns the current pointer", async () => {
    const [counts] = await database.sql<
      { images: number; versions: number; missing_pointers: number }[]
    >`
      select
        (select count(*)::int from images) as images,
        (select count(*)::int from image_versions where version = 1) as versions,
        (select count(*)::int from images where current_version_id is null) as missing_pointers
    `;
    expect(counts).toEqual({ images: 1, versions: 1, missing_pointers: 0 });

    const [historical] = await database.sql<
      {
        physical_filename: string;
        storage_key: string;
        points_current: boolean;
      }[]
    >`
      select versions.physical_filename,
             versions.storage_key,
             images.current_version_id = versions.id as points_current
      from images
      join image_versions versions on versions.image_id = images.id
      where images.id = ${imageId} and versions.version = 1
    `;
    expect(historical).toEqual({
      physical_filename: "00.jpg",
      storage_key: "Media/media-series/1/00.jpg",
      points_current: true,
    });
  });

  it("enforces positive and unique physical versions", async () => {
    await expect(
      database.sql`
        insert into image_versions (
          image_id, version, physical_filename, storage_key, extension,
          content_type, size_bytes, checksum
        ) values (
          ${imageId}, 0, 'invalid.jpg', 'Media/media-series/1/invalid.jpg',
          'jpg', 'image/jpeg', 1, 'invalid'
        )
      `,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.sql`
        insert into image_versions (
          image_id, version, physical_filename, storage_key, extension,
          content_type, size_bytes, checksum
        ) values (
          ${imageId}, 1, 'duplicate.jpg', 'Media/media-series/1/duplicate.jpg',
          'jpg', 'image/jpeg', 1, 'duplicate'
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("serializes concurrent replacements as v2 and v3", async () => {
    const repository = new DrizzleMediaReplacementRepository(database.db);
    const replace = () =>
      repository.withLockedImage(imageId, async (transaction) => {
        const version = transaction.image.current.version + 1;
        const filename = `00_v${version}.jpg`;
        await transaction.cutover({
          operationId: randomUUID(),
          actorId: userId,
          oldPublicUrl: `https://media.nodeprox.org/media-series/1/${transaction.image.current.physicalFilename}`,
          next: {
            version,
            physicalFilename: filename,
            storageKey: `Media/media-series/1/${filename}`,
            extension: "jpg",
            contentType: "image/jpeg",
            sizeBytes: version * 100,
            checksum: `checksum-v${version}`,
          },
        });
        return version;
      });

    const versions = (await Promise.all([replace(), replace()])).sort();
    expect(versions).toEqual([2, 3]);
    const [current] = await database.sql<
      { id: string; version: number; filename: string; storage_key: string }[]
    >`
      select images.id, versions.version, images.filename, images.storage_key
      from images
      join image_versions versions on versions.id = images.current_version_id
      where images.id = ${imageId}
    `;
    expect(current).toEqual({
      id: imageId,
      version: 3,
      filename: "00_v3.jpg",
      storage_key: "Media/media-series/1/00_v3.jpg",
    });

    const effects = await database.sql<
      { effect_type: string; target: string }[]
    >`
      select effect_type, target
      from media_effect_outbox
      where image_id = ${imageId}
      order by created_at, effect_type
    `;
    expect(effects).toEqual(
      expect.arrayContaining([
        {
          effect_type: "cdn_purge",
          target: "https://media.nodeprox.org/media-series/1/00.jpg",
        },
        {
          effect_type: "storage_delete",
          target: "Media/media-series/1/00.jpg",
        },
        {
          effect_type: "cdn_purge",
          target: "https://media.nodeprox.org/media-series/1/00_v2.jpg",
        },
        {
          effect_type: "storage_delete",
          target: "Media/media-series/1/00_v2.jpg",
        },
      ]),
    );

    const [existingEffect] = await database.sql<
      {
        replacement_operation_id: string;
        effect_type: string;
        target: string;
      }[]
    >`
      select replacement_operation_id, effect_type, target
      from media_effect_outbox
      where image_id = ${imageId}
      limit 1
    `;
    expect(existingEffect).toBeDefined();
    if (!existingEffect) {
      throw new Error("Expected a media effect outbox row");
    }
    await expect(
      database.sql`
        insert into media_effect_outbox (
          replacement_operation_id, effect_type, image_id, target
        ) values (
          ${existingEffect.replacement_operation_id},
          ${existingEffect.effect_type}::media_effect_type,
          ${imageId},
          ${existingEffect.target}
        )
      `,
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("uses current_version_id rather than max(version) as canonical authority", async () => {
    await database.sql`
      insert into image_versions (
        image_id, version, physical_filename, storage_key, extension,
        content_type, size_bytes, checksum
      ) values (
        ${imageId}, 4, '00_v4.jpg', 'Media/media-series/1/00_v4.jpg',
        'jpg', 'image/jpeg', 400, 'orphan-v4'
      )
    `;
    const image = await new DrizzleImageRepository(database.db).findById(
      imageId,
    );
    expect(image).toMatchObject({
      id: imageId,
      filename: "00_v3.jpg",
      storageKey: "Media/media-series/1/00_v3.jpg",
    });
  });
});
