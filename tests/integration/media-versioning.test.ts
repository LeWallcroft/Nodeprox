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
import { DrizzleImageRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/image.repository.js";
import { DrizzleImageReplacementOperationRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/image-replacement-operation.repository.js";
import { DrizzleImageVersionResultRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/image-version-result.repository.js";
import { DrizzleMediaReplacementRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/media-replacement.repository.js";
import { createDatabase } from "../../database/client.js";

const infrastructure = inject("infrastructure");
const databaseName = `nodeprox_media_${randomUUID().replaceAll("-", "")}`;
const admin = postgres(infrastructure.databaseUrl, { max: 1 });
const userId = randomUUID();
const seriesId = randomUUID();
const chapterId = randomUUID();
const imageId = randomUUID();
let database: ReturnType<typeof createDatabase>;
let durableVersionId: string;
let durableOperationId: string;

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
  it("persists durable replacement operations with CAS and immutable completion", async () => {
    const repository = new DrizzleImageReplacementOperationRepository(
      database.db,
    );
    const operationId = randomUUID();
    const [currentVersion] = await database.sql<{ id: string }[]>`
      select current_version_id as id from images where id = ${imageId}
    `;
    if (!currentVersion) throw new Error("missing-current-image-version");
    const firstVersionId = currentVersion.id;
    const now = new Date();
    const created = await repository.create({
      id: operationId,
      imageId,
      chapterId,
      requestedByUserId: userId,
      candidateStorageKey: `replacement/${operationId}`,
      originalFilename: "replacement.jpg",
      contentType: "image/jpeg",
      sizeBytes: 123,
      status: "pending_upload",
    });
    if (!created) throw new Error("missing-replacement-operation");
    expect(created.status).toBe("pending_upload");
    expect(await repository.findById(randomUUID())).toBeNull();
    expect((await repository.markUploaded(operationId, now))?.status).toBe(
      "uploaded",
    );
    const attempts = await Promise.all([
      repository.tryBeginCompletion(operationId, now),
      repository.tryBeginCompletion(operationId, now),
    ]);
    expect(attempts.filter((item) => item.acquired)).toHaveLength(1);
    expect(
      attempts.every((item) => item.operation?.status === "completing"),
    ).toBe(true);
    const completed = await repository.markCompleted({
      operationId,
      resultImageVersionId: firstVersionId,
      completedAt: now,
    });
    expect(completed?.resultImageVersionId).toBe(firstVersionId);
    expect(
      (
        await repository.markCompleted({
          operationId,
          resultImageVersionId: firstVersionId,
          completedAt: now,
        })
      )?.resultImageVersionId,
    ).toBe(firstVersionId);
    await expect(
      repository.markCompleted({
        operationId,
        resultImageVersionId: randomUUID(),
        completedAt: now,
      }),
    ).rejects.toThrow("image-replacement-operation-result-conflict");
    expect((await repository.findById(operationId))?.resultImageVersionId).toBe(
      firstVersionId,
    );
  });
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

  it("commits CASE8 cutover and durable operation completion atomically", async () => {
    const operations = new DrizzleImageReplacementOperationRepository(
      database.db,
    );
    const repository = new DrizzleMediaReplacementRepository(database.db);
    const operationId = randomUUID();
    const completedAt = new Date();
    await operations.create({
      id: operationId,
      imageId,
      chapterId,
      requestedByUserId: userId,
      candidateStorageKey: `Media/media-series/1/${operationId}.jpg`,
      originalFilename: "replacement.jpg",
      contentType: "image/jpeg",
      sizeBytes: 400,
      status: "pending_upload",
    });
    await operations.tryBeginCompletion(operationId, completedAt);
    const [beforeAudit] = await database.sql<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where resource_type = 'image' and resource_id = ${imageId}
        and action = 'image.replaced'
    `;

    const activated = await repository.withLockedImage(
      imageId,
      async (transaction) => {
        const version = transaction.image.current.version + 1;
        const cutover = await transaction.cutover({
          operationId,
          actorId: userId,
          oldPublicUrl: `https://media.nodeprox.org/media-series/1/${transaction.image.current.physicalFilename}`,
          next: {
            version,
            physicalFilename: `${operationId}.jpg`,
            storageKey: `Media/media-series/1/${operationId}.jpg`,
            extension: "jpg",
            contentType: "image/jpeg",
            sizeBytes: 400,
            checksum: "atomic-v4",
          },
        });
        await transaction.completeReplacementOperation({
          operationId,
          imageId,
          actorId: userId,
          resultImageVersionId: cutover.versionId,
          completedAt,
        });
        return { version, versionId: cutover.versionId };
      },
    );
    if (!activated) throw new Error("missing-atomic-activation");
    durableVersionId = activated.versionId;
    durableOperationId = operationId;

    const operation = await operations.findById(operationId);
    expect(operation).toMatchObject({
      status: "completed",
      resultImageVersionId: activated.versionId,
      completedAt,
      lastErrorCode: null,
    });
    const [current] = await database.sql<
      { current_version_id: string; version: number }[]
    >`
      select images.current_version_id, versions.version
      from images
      join image_versions versions on versions.id = images.current_version_id
      where images.id = ${imageId}
    `;
    expect(current).toEqual({
      current_version_id: activated.versionId,
      version: activated.version,
    });
    const effects = await database.sql<{ effect_type: string }[]>`
      select effect_type from media_effect_outbox
      where replacement_operation_id = ${operationId}
      order by effect_type
    `;
    expect(effects).toEqual([
      { effect_type: "cdn_purge" },
      { effect_type: "storage_delete" },
    ]);
    const [afterAudit] = await database.sql<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where resource_type = 'image' and resource_id = ${imageId}
        and action = 'image.replaced'
    `;
    expect(afterAudit?.count).toBe((beforeAudit?.count ?? 0) + 1);
  });

  it("does not overwrite a durable operation with another version result", async () => {
    const repository = new DrizzleMediaReplacementRepository(database.db);
    const [before] = await database.sql<
      { versions: number; current_version_id: string }[]
    >`
      select
        (select count(*)::int from image_versions where image_id = ${imageId}) as versions,
        (select current_version_id from images where id = ${imageId}) as current_version_id
    `;

    await expect(
      repository.withLockedImage(imageId, async (transaction) => {
        const version = transaction.image.current.version + 1;
        const filename = `${randomUUID()}.jpg`;
        const cutover = await transaction.cutover({
          operationId: randomUUID(),
          actorId: userId,
          oldPublicUrl: `https://media.nodeprox.org/media-series/1/${transaction.image.current.physicalFilename}`,
          next: {
            version,
            physicalFilename: filename,
            storageKey: `Media/media-series/1/${filename}`,
            extension: "jpg",
            contentType: "image/jpeg",
            sizeBytes: 450,
            checksum: "conflicting-result",
          },
        });
        await transaction.completeReplacementOperation({
          operationId: durableOperationId,
          imageId,
          actorId: userId,
          resultImageVersionId: cutover.versionId,
          completedAt: new Date(),
        });
      }),
    ).rejects.toThrow("image-replacement-operation-result-conflict");

    const [after] = await database.sql<
      { versions: number; current_version_id: string }[]
    >`
      select
        (select count(*)::int from image_versions where image_id = ${imageId}) as versions,
        (select current_version_id from images where id = ${imageId}) as current_version_id
    `;
    expect(after).toEqual(before);
    expect(
      (
        await new DrizzleImageReplacementOperationRepository(
          database.db,
        ).findById(durableOperationId)
      )?.resultImageVersionId,
    ).toBe(durableVersionId);
  });

  it("rolls back cutover, effects, and audit when durable completion fails", async () => {
    const operations = new DrizzleImageReplacementOperationRepository(
      database.db,
    );
    const repository = new DrizzleMediaReplacementRepository(database.db);
    const operationId = randomUUID();
    const completedAt = new Date();
    await operations.create({
      id: operationId,
      imageId,
      chapterId,
      requestedByUserId: userId,
      candidateStorageKey: `Media/media-series/1/${operationId}.jpg`,
      originalFilename: "rollback.jpg",
      contentType: "image/jpeg",
      sizeBytes: 500,
      status: "pending_upload",
    });
    await operations.tryBeginCompletion(operationId, completedAt);
    const [before] = await database.sql<
      { versions: number; audits: number; current_version_id: string }[]
    >`
      select
        (select count(*)::int from image_versions where image_id = ${imageId}) as versions,
        (select count(*)::int from audit_log where resource_type = 'image'
          and resource_id = ${imageId} and action = 'image.replaced') as audits,
        (select current_version_id from images where id = ${imageId}) as current_version_id
    `;

    await expect(
      repository.withLockedImage(imageId, async (transaction) => {
        const version = transaction.image.current.version + 1;
        const cutover = await transaction.cutover({
          operationId,
          actorId: userId,
          oldPublicUrl: `https://media.nodeprox.org/media-series/1/${transaction.image.current.physicalFilename}`,
          next: {
            version,
            physicalFilename: `${operationId}.jpg`,
            storageKey: `Media/media-series/1/${operationId}.jpg`,
            extension: "jpg",
            contentType: "image/jpeg",
            sizeBytes: 500,
            checksum: "must-rollback",
          },
        });
        await transaction.completeReplacementOperation({
          operationId,
          imageId: randomUUID(),
          actorId: userId,
          resultImageVersionId: cutover.versionId,
          completedAt,
        });
      }),
    ).rejects.toThrow("image-replacement-operation-completion-conflict");

    const [after] = await database.sql<
      { versions: number; audits: number; current_version_id: string }[]
    >`
      select
        (select count(*)::int from image_versions where image_id = ${imageId}) as versions,
        (select count(*)::int from audit_log where resource_type = 'image'
          and resource_id = ${imageId} and action = 'image.replaced') as audits,
        (select current_version_id from images where id = ${imageId}) as current_version_id
    `;
    expect(after).toEqual(before);
    expect(
      await database.sql`
        select id from media_effect_outbox
        where replacement_operation_id = ${operationId}
      `,
    ).toHaveLength(0);
    expect(await operations.findById(operationId)).toMatchObject({
      status: "completing",
      resultImageVersionId: null,
      completedAt: null,
    });
  });

  it("projects an immutable historical result after a later version is current", async () => {
    const repository = new DrizzleMediaReplacementRepository(database.db);
    await repository.withLockedImage(imageId, async (transaction) => {
      const version = transaction.image.current.version + 1;
      const filename = `${randomUUID()}.jpg`;
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
          sizeBytes: 600,
          checksum: "later-version",
        },
      });
    });
    const projection = new DrizzleImageVersionResultRepository(
      database.db,
      "https://media.nodeprox.org",
    );
    const result = await projection.findVersionResultById(durableVersionId);
    expect(result).toMatchObject({
      imageId,
      versionId: durableVersionId,
      version: 4,
      storageKey: expect.stringContaining("Media/media-series/1/"),
    });
    expect(result?.publicUrl).toBe(
      `https://media.nodeprox.org/media-series/1/${result?.filename}`,
    );
    expect(await projection.findVersionResultById(randomUUID())).toBeNull();
    const [current] = await database.sql<{ current_version_id: string }[]>`
      select current_version_id from images where id = ${imageId}
    `;
    expect(current?.current_version_id).not.toBe(durableVersionId);
  });

  it("uses current_version_id rather than max(version) as canonical authority", async () => {
    const [before] = await database.sql<
      { filename: string; storage_key: string }[]
    >`
      select filename, storage_key from images where id = ${imageId}
    `;
    await database.sql`
      insert into image_versions (
        image_id, version, physical_filename, storage_key, extension,
        content_type, size_bytes, checksum
      ) values (
        ${imageId}, 100, 'orphan.jpg', 'Media/media-series/1/orphan.jpg',
        'jpg', 'image/jpeg', 1000, 'orphan'
      )
    `;
    const image = await new DrizzleImageRepository(database.db).findById(
      imageId,
    );
    expect(image).toMatchObject({
      id: imageId,
      filename: before?.filename,
      storageKey: before?.storage_key,
    });
  });
});
