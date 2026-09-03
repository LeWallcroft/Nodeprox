import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ChapterProcessingService } from "../../apps/worker/src/processing/application/chapter-processing.service.js";
import type {
  ProcessingAuditPort,
  ZipExtractorPort,
} from "../../apps/worker/src/processing/application/ports.js";
import type { ValidatedImage } from "../../apps/worker/src/processing/domain/image-policy.js";
import { DrizzleProcessingRepository } from "../../apps/worker/src/processing/infrastructure/persistence/drizzle/processing.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapters,
  images,
  series,
  uploads,
  users,
} from "../../database/schema/index.js";
import { FilesystemStorage } from "../../packages/storage/src/adapters.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const userId = randomUUID();
const seriesId = randomUUID();
const chapterIds: string[] = [];
const uploadIds: string[] = [];
let storageRoot: string;

const image: ValidatedImage = {
  filename: "01.jpg",
  extension: "jpg",
  contentType: "image/jpeg",
  sortOrder: 1,
  sizeBytes: 3,
  checksum: "checksum-01",
  warnings: [],
  tempPath: "temporary-image",
};

function extractorFor(inspect: ZipExtractorPort["inspect"]): ZipExtractorPort {
  return {
    inspect,
    readImage: () => Readable.from([Buffer.from("img")]),
    dispose: async () => undefined,
  };
}

const audit: ProcessingAuditPort = { append: async () => undefined };

async function createFixture() {
  const chapterId = randomUUID();
  const uploadId = randomUUID();
  chapterIds.push(chapterId);
  uploadIds.push(uploadId);
  const storageKey = `uploads/${seriesId}/${chapterId}/${uploadId}.zip`;
  await database.db.insert(chapters).values({
    id: chapterId,
    seriesId,
    chapterNumber: chapterIds.length,
    publicKey: String(chapterIds.length),
    createdBy: userId,
    status: "uploaded",
  });
  await database.db.insert(uploads).values({
    id: uploadId,
    chapterId,
    storageKey,
    originalFilename: "chapter.zip",
    contentType: "application/zip",
    sizeBytes: 3,
    createdBy: userId,
    status: "uploaded",
  });
  return { chapterId, uploadId, storageKey };
}

beforeAll(async () => {
  storageRoot = await mkdtemp(`${tmpdir()}\\nodeprox-m4b-`);
  await database.db.insert(users).values({
    id: userId,
    email: `m4b-${userId}@example.com`,
    passwordHash: "not-used",
    status: "active",
    role: "uploader",
  });
  await database.db.insert(series).values({
    id: seriesId,
    title: "M4-B",
    slug: `m4b-${seriesId}`,
    createdBy: userId,
  });
});

afterAll(async () => {
  await database.db.delete(auditLogs).where(eq(auditLogs.actorId, userId));
  await database.db.delete(images).where(inArray(images.chapterId, chapterIds));
  await database.db.delete(uploads).where(inArray(uploads.id, uploadIds));
  await database.db.delete(chapters).where(inArray(chapters.id, chapterIds));
  await database.db.delete(series).where(eq(series.id, seriesId));
  await database.db.delete(users).where(eq(users.id, userId));
  await rm(storageRoot, { recursive: true, force: true });
  await database.sql.end();
});

describe("M4-B processing integration", () => {
  it("sanitizes processing audit metadata at the persistence boundary", async () => {
    const repository = new DrizzleProcessingRepository(database.db);
    const actorId = userId;
    await repository.append({
      actorId,
      action: "chapter.processing.completed",
      resourceType: "chapter",
      metadata: { result: "completed", imageCount: 4 },
    });
    const [record] = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, actorId));
    expect(record?.metadata).toEqual({ result: "completed", imageCount: 4 });
    await expect(
      repository.append({
        actorId,
        action: "chapter.processing.failed",
        resourceType: "chapter",
        metadata: {
          token: "not-persisted",
          accessToken: "not-persisted",
          cookie: "not-persisted",
          authorization: "not-persisted",
          B2_APPLICATION_KEY: "not-persisted",
        },
      }),
    ).rejects.toThrow("Audit metadata key is not allowed");
    await database.db.delete(auditLogs).where(eq(auditLogs.actorId, actorId));
  });

  it("processes uploaded to ready and persists image metadata", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: Readable.from([Buffer.from("zip")]),
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    const service = new ChapterProcessingService(
      repository,
      storage,
      extractorFor(async () => [image]),
      audit,
    );
    await service.process({
      chapterId: fixture.chapterId,
      seriesId,
      uploadId: fixture.uploadId,
      sourceStorageKey: fixture.storageKey,
    });
    const [chapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, fixture.chapterId));
    const rows = await database.db
      .select()
      .from(images)
      .where(eq(images.chapterId, fixture.chapterId));
    expect(chapter?.status).toBe("ready");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filename: "01.jpg",
      storageKey: `Media/m4b-${seriesId}/${chapterIds.indexOf(fixture.chapterId) + 1}/01.jpg`,
      sortOrder: 1,
      contentType: "image/jpeg",
    });
    await expect(storage.exists(fixture.storageKey)).resolves.toBe(false);
  });

  it("allows a retry after a transient failure without duplicating metadata", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: Readable.from([Buffer.from("zip")]),
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    let attempts = 0;
    const service = new ChapterProcessingService(
      repository,
      storage,
      extractorFor(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient");
        return [image];
      }),
      audit,
    );
    const input = {
      chapterId: fixture.chapterId,
      seriesId,
      uploadId: fixture.uploadId,
      sourceStorageKey: fixture.storageKey,
    };
    await expect(service.process(input)).rejects.toThrow("transient");
    await expect(storage.exists(fixture.storageKey)).resolves.toBe(true);
    const [afterTransientFailure] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, fixture.chapterId));
    expect(afterTransientFailure?.status).toBe("uploaded");
    await service.process(input);
    const rows = await database.db
      .select()
      .from(images)
      .where(eq(images.chapterId, fixture.chapterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sortOrder).toBe(1);
  });

  it("allows only one concurrent processor to claim a Chapter", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: Readable.from([Buffer.from("zip")]),
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    const service = new ChapterProcessingService(
      repository,
      storage,
      extractorFor(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return [image];
      }),
      audit,
    );
    const input = {
      chapterId: fixture.chapterId,
      seriesId,
      uploadId: fixture.uploadId,
      sourceStorageKey: fixture.storageKey,
    };
    await Promise.all([service.process(input), service.process(input)]);
    const rows = await database.db
      .select()
      .from(images)
      .where(eq(images.chapterId, fixture.chapterId));
    expect(rows).toHaveLength(1);
  });
});
