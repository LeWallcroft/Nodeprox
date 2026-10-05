import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { ChapterProcessingService } from "../../apps/worker/src/processing/application/chapter-processing.service.js";
import { DrizzleIntegrityRepository } from "../../apps/api/src/modules/reconciliation/infrastructure/drizzle-integrity.repository.js";
import type {
  ProcessingAuditPort,
  ZipExtractorPort,
} from "../../apps/worker/src/processing/application/ports.js";
import type { ValidatedImage } from "../../apps/worker/src/processing/domain/image-policy.js";
import { DrizzleProcessingRepository } from "../../apps/worker/src/processing/infrastructure/persistence/drizzle/processing.repository.js";
import { DrizzleRetryUploadOperationRepository } from "../../apps/api/src/modules/uploads/infrastructure/persistence/drizzle/retry-upload-operation.repository.js";
import { RetryUploadOperationService } from "../../apps/api/src/modules/uploads/application/services/retry-upload-operation.service.js";
import { DrizzleUploadOperationReadRepository } from "../../apps/api/src/modules/uploads/infrastructure/persistence/drizzle/upload-operation-read.repository.js";
import { StorageProviderUnavailableError } from "@nodeprox/storage/errors";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterProcessingAttempts,
  chapterProcessingObjects,
  chapters,
  images,
  imageVersions,
  series,
  uploads,
  uploadValidationEntries,
  uploadValidationRuns,
  storageCleanupOutbox,
  processingOutbox,
  users,
} from "../../database/schema/index.js";
import { FilesystemStorage } from "@nodeprox/storage";
import {
  legacyStorageExecution,
  legacyStorageProfileId,
} from "../helpers/storage-execution.js";

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
  checksum: createHash("sha256").update("img").digest("hex"),
  warnings: [],
  tempPath: "temporary-image",
};

function extractorFor(inspect: ZipExtractorPort["inspect"]): ZipExtractorPort {
  return {
    inspect,
    readImage: () => Readable.from([Buffer.from("img")]),
    replayableImage: () => ({
      sizeBytes: 3,
      open: () => Readable.from([Buffer.from("img")]),
    }),
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
    storageProfileId: legacyStorageProfileId,
    chapterId,
    storageKey,
    originalFilename: "chapter.zip",
    contentType: "application/zip",
    sizeBytes: 3,
    createdBy: userId,
    status: "uploaded",
  });
  const [validation] = await database.db
    .insert(uploadValidationRuns)
    .values({
      uploadId,
      attemptNumber: 1,
      status: "accepted",
      finishedAt: new Date(),
    })
    .returning({ id: uploadValidationRuns.id });
  if (!validation) throw new Error("validation-fixture-create-failed");
  await database.db.insert(uploadValidationEntries).values({
    runId: validation.id,
    filename: image.filename,
    extension: image.extension,
    contentType: image.contentType,
    sortOrder: image.sortOrder,
    sizeBytes: image.sizeBytes,
    checksumSha256: image.checksum,
    warnings: [],
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
  it("serializes orphan cleanup with a Chapter processing claim", async () => {
    const { chapterId, uploadId } = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    const attemptId = randomUUID();
    const candidateId = randomUUID();
    const storageKey = `Media/m4b-${seriesId}/${chapterIds.length}/01.jpg`;
    await database.db
      .update(chapters)
      .set({ status: "failed" })
      .where(eq(chapters.id, chapterId));
    await database.db.insert(chapterProcessingAttempts).values({
      id: attemptId,
      storageProfileId: legacyStorageProfileId,
      chapterId,
      uploadId,
      attemptNumber: 1,
      status: "terminal_failed",
      finishedAt: new Date(),
    });
    await database.db.insert(chapterProcessingObjects).values({
      id: candidateId,
      storageProfileId: legacyStorageProfileId,
      attemptId,
      storageKey,
      checksum: image.checksum,
      status: "cleanup_pending",
    });
    await storage.put({
      key: storageKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("img")]) },
      contentType: "image/jpeg",
      sizeBytes: 3,
    });
    const candidate = {
      id: candidateId,
      chapterId,
      storageProfileId: legacyStorageProfileId,
      uploadId,
      attemptId,
      storageKey,
      checksum: image.checksum,
      status: "cleanup_pending" as const,
      attemptStatus: "terminal_failed",
      createdAt: new Date("2020-01-01"),
    };
    const repository = new DrizzleIntegrityRepository(database.db);
    await database.db
      .update(chapters)
      .set({ status: "processing" })
      .where(eq(chapters.id, chapterId));
    expect(
      await repository.withCandidateCleanupLock(candidate, () =>
        storage.delete(storageKey),
      ),
    ).toBe(false);
    expect(await storage.exists(storageKey)).toBe(true);
    await database.db
      .update(chapters)
      .set({ status: "failed" })
      .where(eq(chapters.id, chapterId));
    expect(
      await repository.withCandidateCleanupLock(candidate, () =>
        storage.delete(storageKey),
      ),
    ).toBe(true);
    expect(await storage.exists(storageKey)).toBe(false);
    const [cleaned] = await database.db
      .select({ status: chapterProcessingObjects.status })
      .from(chapterProcessingObjects)
      .where(eq(chapterProcessingObjects.id, candidateId));
    expect(cleaned?.status).toBe("cleaned");
  });

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

  it("reuses the same durable attempt for a re-delivered job invocation", async () => {
    const fixture = await createFixture();
    const repository = new DrizzleProcessingRepository(database.db);
    const invocation = {
      chapterId: fixture.chapterId,
      uploadId: fixture.uploadId,
      jobId: `chapter-processing-${fixture.chapterId}-${fixture.uploadId}`,
      jobAttempt: 1,
    };
    const claimed = await repository.claimChapter(invocation);
    expect(claimed.outcome).toBe("claimed");
    const resumed = await repository.claimChapter(invocation);
    expect(resumed.outcome).toBe("resumed");
    if (!("attempt" in resumed)) throw new Error("expected-processing-attempt");
    await repository.markFailed(
      fixture.chapterId,
      fixture.uploadId,
      resumed.attempt.id,
      {
        disposition: "retryable",
        errorCode: "PROCESSING_UNKNOWN",
        errorMessage: "temporary",
      },
      userId,
    );
    const finished = await repository.claimChapter(invocation);
    expect(finished.outcome).toBe("finished");
    const attempts = await database.db
      .select()
      .from(chapterProcessingAttempts)
      .where(eq(chapterProcessingAttempts.chapterId, fixture.chapterId));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("retryable_failed");
  });

  it("processes uploaded to ready and persists image metadata", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("zip")]) },
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    const service = new ChapterProcessingService(
      repository,
      legacyStorageExecution(storage),
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
    const [attempt] = await database.db
      .select()
      .from(chapterProcessingAttempts)
      .where(eq(chapterProcessingAttempts.chapterId, fixture.chapterId));
    expect(attempt).toMatchObject({
      attemptNumber: 1,
      status: "succeeded",
      errorCode: null,
      storageProfileId: legacyStorageProfileId,
    });
    expect(attempt?.finishedAt).toBeInstanceOf(Date);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      filename: "01.jpg",
      storageProfileId: legacyStorageProfileId,
      storageKey: `Media/m4b-${seriesId}/${chapterIds.indexOf(fixture.chapterId) + 1}/01.jpg`,
      sortOrder: 1,
      contentType: "image/jpeg",
    });
    const publishedImage = rows[0];
    if (!publishedImage || !attempt)
      throw new Error("missing-processing-lineage");
    const [version] = await database.db
      .select({ storageProfileId: imageVersions.storageProfileId })
      .from(imageVersions)
      .where(eq(imageVersions.id, publishedImage.currentVersionId));
    expect(version?.storageProfileId).toBe(legacyStorageProfileId);
    const candidates = await database.db
      .select({ storageProfileId: chapterProcessingObjects.storageProfileId })
      .from(chapterProcessingObjects)
      .where(eq(chapterProcessingObjects.attemptId, attempt.id));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.storageProfileId).toBe(legacyStorageProfileId);
    await expect(storage.exists(fixture.storageKey)).resolves.toBe(true);
    const cleanup = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.uploadId, fixture.uploadId));
    expect(cleanup).toHaveLength(1);
    expect(cleanup[0]).toMatchObject({
      reason: "chapter_source_zip",
      status: "pending",
    });
  });

  it("allows a retry after a transient failure without duplicating metadata", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("zip")]) },
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    let attempts = 0;
    const service = new ChapterProcessingService(
      repository,
      legacyStorageExecution(storage),
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
    const [retryableAttempt] = await database.db
      .select()
      .from(chapterProcessingAttempts)
      .where(eq(chapterProcessingAttempts.chapterId, fixture.chapterId));
    expect(retryableAttempt).toMatchObject({
      status: "retryable_failed",
      errorCode: "PROCESSING_UNKNOWN",
      errorMessage: "transient",
    });
    await service.process(input);
    const rows = await database.db
      .select()
      .from(images)
      .where(eq(images.chapterId, fixture.chapterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sortOrder).toBe(1);
    const attemptRows = await database.db
      .select()
      .from(chapterProcessingAttempts)
      .where(eq(chapterProcessingAttempts.chapterId, fixture.chapterId))
      .orderBy(asc(chapterProcessingAttempts.attemptNumber));
    expect(
      attemptRows.map(({ attemptNumber, status }) => ({
        attemptNumber,
        status,
      })),
    ).toEqual([
      { attemptNumber: 1, status: "retryable_failed" },
      { attemptNumber: 2, status: "succeeded" },
    ]);
  });

  it("retains the source after exhausted transient attempts and requeues the same upload", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("zip")]) },
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    const failed = new ChapterProcessingService(
      repository,
      legacyStorageExecution(storage),
      extractorFor(async () => {
        throw new StorageProviderUnavailableError({ httpStatus: 503 });
      }),
      audit,
    );
    const input = {
      chapterId: fixture.chapterId,
      seriesId,
      uploadId: fixture.uploadId,
      sourceStorageKey: fixture.storageKey,
    };
    for (let attempt = 1; attempt <= 3; attempt += 1)
      await expect(failed.process(input, attempt === 3)).rejects.toMatchObject({
        code: "STORAGE_PROVIDER_UNAVAILABLE",
      });
    const attempts = await database.db
      .select({ status: chapterProcessingAttempts.status })
      .from(chapterProcessingAttempts)
      .where(eq(chapterProcessingAttempts.uploadId, fixture.uploadId))
      .orderBy(asc(chapterProcessingAttempts.attemptNumber));
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "retryable_failed",
      "retryable_failed",
      "retry_exhausted",
    ]);
    const [before] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, fixture.chapterId));
    expect(before?.status).toBe("uploaded");
    expect(await storage.exists(fixture.storageKey)).toBe(true);
    expect(
      await database.db
        .select()
        .from(storageCleanupOutbox)
        .where(eq(storageCleanupOutbox.uploadId, fixture.uploadId)),
    ).toHaveLength(0);
    const projected = await new DrizzleUploadOperationReadRepository(
      database.db,
    ).listForUser({ userId, limit: 100 });
    expect(
      projected.find((operation) => operation.id === fixture.uploadId),
    ).toMatchObject({
      kind: "chapter_upload",
      status: "retry_exhausted",
      failureStage: "processing",
    });

    const retry = new RetryUploadOperationService(
      {
        check: async () => ({ allowed: true, reason: "assigned", seriesId }),
      } as never,
      new DrizzleRetryUploadOperationRepository(database.db),
      legacyStorageExecution(storage),
    );
    await expect(
      retry.retryUploadOperation({
        context: { userId, sessionId: randomUUID() },
        kind: "chapter_upload",
        operationId: fixture.uploadId,
        requestId: "manual-retry",
      }),
    ).resolves.toEqual({ status: "uploaded", stage: "processing" });
    const intents = await database.db
      .select()
      .from(processingOutbox)
      .where(eq(processingOutbox.uploadId, fixture.uploadId));
    expect(intents).toHaveLength(1);
    expect(intents[0]?.storageKey).toBe(fixture.storageKey);
    await new ChapterProcessingService(
      repository,
      legacyStorageExecution(storage),
      extractorFor(async () => [image]),
      audit,
    ).process(input);
    const [after] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, fixture.chapterId));
    expect(after?.status).toBe("ready");
  });

  it("rejects a changed source manifest before writing permanent media", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("zip")]) },
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const changed = { ...image, checksum: "f".repeat(64) };
    await expect(
      new ChapterProcessingService(
        new DrizzleProcessingRepository(database.db),
        legacyStorageExecution(storage),
        extractorFor(async () => [changed]),
        audit,
      ).process({
        chapterId: fixture.chapterId,
        seriesId,
        uploadId: fixture.uploadId,
        sourceStorageKey: fixture.storageKey,
      }),
    ).rejects.toThrow("VALIDATION_MANIFEST_MISMATCH");
    expect(
      await database.db
        .select()
        .from(images)
        .where(eq(images.chapterId, fixture.chapterId)),
    ).toHaveLength(0);
    expect(
      await database.db
        .select()
        .from(chapterProcessingObjects)
        .where(
          eq(
            chapterProcessingObjects.storageKey,
            `Media/m4b-${seriesId}/${chapterIds.length}/01.jpg`,
          ),
        ),
    ).toHaveLength(0);
  });

  it("persists terminal provenance for a non-retryable ZIP failure", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("zip")]) },
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    const service = new ChapterProcessingService(
      repository,
      legacyStorageExecution(storage),
      extractorFor(async () => {
        throw new Error("invalid-zip-layout");
      }),
      audit,
    );
    await expect(
      service.process({
        chapterId: fixture.chapterId,
        seriesId,
        uploadId: fixture.uploadId,
        sourceStorageKey: fixture.storageKey,
      }),
    ).rejects.toThrow("ZIP_INVALID");
    const [chapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, fixture.chapterId));
    const [attempt] = await database.db
      .select()
      .from(chapterProcessingAttempts)
      .where(eq(chapterProcessingAttempts.chapterId, fixture.chapterId));
    expect(chapter?.status).toBe("failed");
    expect(attempt).toMatchObject({
      status: "terminal_failed",
      errorCode: "ZIP_INVALID",
      errorMessage: "invalid-zip-layout",
    });
  });

  it("preserves previously published media when a new attempt fails", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("zip")]) },
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    await new ChapterProcessingService(
      repository,
      legacyStorageExecution(storage),
      extractorFor(async () => [image]),
      audit,
    ).process({
      chapterId: fixture.chapterId,
      seriesId,
      uploadId: fixture.uploadId,
      sourceStorageKey: fixture.storageKey,
    });
    const publishedKey = `Media/m4b-${seriesId}/${chapterIds.indexOf(fixture.chapterId) + 1}/01.jpg`;

    const retryUploadId = randomUUID();
    const retrySourceKey = `uploads/${seriesId}/${fixture.chapterId}/${retryUploadId}.zip`;
    uploadIds.push(retryUploadId);
    await database.db
      .update(chapters)
      .set({ status: "uploaded" })
      .where(eq(chapters.id, fixture.chapterId));
    await database.db.insert(uploads).values({
      id: retryUploadId,
      storageProfileId: legacyStorageProfileId,
      chapterId: fixture.chapterId,
      storageKey: retrySourceKey,
      originalFilename: "retry.zip",
      contentType: "application/zip",
      sizeBytes: 3,
      createdBy: userId,
      status: "uploaded",
    });
    await storage.put({
      key: retrySourceKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("zip")]) },
      contentType: "application/zip",
      sizeBytes: 3,
    });
    await expect(
      new ChapterProcessingService(
        repository,
        legacyStorageExecution(storage),
        extractorFor(async () => {
          throw new Error("temporary");
        }),
        audit,
      ).process({
        chapterId: fixture.chapterId,
        seriesId,
        uploadId: retryUploadId,
        sourceStorageKey: retrySourceKey,
      }),
    ).rejects.toThrow("temporary");
    const rows = await database.db
      .select()
      .from(images)
      .where(eq(images.chapterId, fixture.chapterId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.storageKey).toBe(publishedKey);
    await expect(storage.exists(publishedKey)).resolves.toBe(true);
    expect(
      Buffer.concat(await (await storage.get(publishedKey)).toArray()),
    ).toEqual(Buffer.from("img"));
  });

  it("allows only one concurrent processor to claim a Chapter", async () => {
    const fixture = await createFixture();
    const storage = new FilesystemStorage(storageRoot);
    await storage.put({
      key: fixture.storageKey,
      body: { sizeBytes: 3, open: () => Readable.from([Buffer.from("zip")]) },
      contentType: "application/zip",
      sizeBytes: 3,
    });
    const repository = new DrizzleProcessingRepository(database.db);
    const service = new ChapterProcessingService(
      repository,
      legacyStorageExecution(storage),
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
