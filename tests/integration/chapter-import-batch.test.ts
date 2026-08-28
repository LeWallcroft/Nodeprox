import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  StoragePort,
  UploadTransferPort,
} from "../../packages/storage/src/port.js";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterImportBatches,
  chapterImportItems,
  chapters,
  images,
  processingOutbox,
  series,
  uploads,
  users,
} from "../../database/schema/index.js";
import { ChapterProcessingService } from "../../apps/worker/src/processing/application/chapter-processing.service.js";
import { DrizzleProcessingRepository } from "../../apps/worker/src/processing/infrastructure/persistence/drizzle/processing.repository.js";
import type { ZipExtractorPort } from "../../apps/worker/src/processing/application/ports.js";
import type { ValidatedImage } from "../../apps/worker/src/processing/domain/image-policy.js";

class FakeTransfer implements UploadTransferPort {
  readonly keys: string[] = [];
  async initiate(input: { key: string; contentType: string }) {
    this.keys.push(input.key);
    return {
      mode: "single" as const,
      method: "PUT" as const,
      url: `https://upload.example.test/${this.keys.length}`,
      headers: { "content-type": input.contentType },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  async verify(input: { key: string }) {
    return { key: input.key, sizeBytes: 4, contentType: "application/zip" };
  }
  async abort() {}
}

class MemoryStorage implements StoragePort {
  readonly keys = new Set<string>();
  async put(input: {
    key: string;
    body: NodeJS.ReadableStream;
    sizeBytes: number;
    contentType: string;
  }) {
    input.body.resume();
    this.keys.add(input.key);
    return {
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
    };
  }
  async get(key: string) {
    this.keys.add(key);
    return Readable.from([Buffer.from("zip!")]);
  }
  async delete(key: string) {
    this.keys.delete(key);
  }
  async exists(key: string) {
    return this.keys.has(key);
  }
}

const processedImage: ValidatedImage = {
  filename: "01.jpg",
  extension: "jpg",
  contentType: "image/jpeg",
  sortOrder: 1,
  sizeBytes: 4,
  checksum: "batch-image-checksum",
  warnings: [],
  tempPath: "batch-image",
};

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const transfer = new FakeTransfer();
const app = buildApp(
  { logger: false },
  {
    database: database.db,
    secureCookie: false,
    storage: { provider: "filesystem", uploadMaxSizeBytes: 1024 },
    uploadTransfer: transfer,
  },
);
const ownerId = randomUUID();
const unrelatedId = randomUUID();
const ownerEmail = `batch-owner-${ownerId}@example.test`;
const unrelatedEmail = `batch-unrelated-${unrelatedId}@example.test`;
const password = "batch-test-password";
const createdSeriesIds: string[] = [];

beforeAll(async () => {
  const passwordHash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: ownerId,
      email: ownerEmail,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: unrelatedId,
      email: unrelatedEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
});

afterAll(async () => {
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, [ownerId, unrelatedId]));
  if (createdSeriesIds.length) {
    const createdChapters = await database.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(inArray(chapters.seriesId, createdSeriesIds));
    await database.db
      .delete(chapterImportBatches)
      .where(inArray(chapterImportBatches.seriesId, createdSeriesIds));
    if (createdChapters.length) {
      const chapterIds = createdChapters.map((chapter) => chapter.id);
      await database.db
        .delete(processingOutbox)
        .where(inArray(processingOutbox.chapterId, chapterIds));
      await database.db
        .delete(images)
        .where(inArray(images.chapterId, chapterIds));
      await database.db
        .delete(uploads)
        .where(inArray(uploads.chapterId, chapterIds));
      await database.db
        .delete(chapters)
        .where(inArray(chapters.id, chapterIds));
    }
    await database.db
      .delete(series)
      .where(inArray(series.id, createdSeriesIds));
  }
  await database.db
    .delete(users)
    .where(inArray(users.id, [ownerId, unrelatedId]));
  await app.close();
  await database.sql.end();
});

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  const header = response.headers["set-cookie"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("session cookie missing");
  return value;
}

describe("ChapterImportBatch metadata orchestration", () => {
  it("creates independent direct-upload items and keeps chapterNumber explicit", async () => {
    const ownerCookie = await login(ownerEmail);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Bulk Raven", slug: `bulk-${randomUUID()}` },
    });
    const seriesId = created.json().id as string;
    createdSeriesIds.push(seriesId);

    const response = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie: ownerCookie },
      payload: {
        items: [
          {
            clientId: "item-25",
            chapterNumber: 25,
            filename: "999.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
          {
            clientId: "item-26",
            chapterNumber: 26,
            filename: "26.zip",
            contentType: "application/pdf",
            sizeBytes: 4,
          },
          {
            clientId: "item-30",
            chapterNumber: 30,
            filename: "30.zip",
            contentType: "application/x-zip-compressed",
            sizeBytes: 4,
          },
        ],
      },
    });
    expect(response.statusCode).toBe(201);
    expect(
      response.json().items.map((item: { status: string }) => item.status),
    ).toEqual(["uploading", "failed", "uploading"]);
    expect(transfer.keys).toHaveLength(2);

    const persistedChapters = await database.db
      .select({ number: chapters.chapterNumber, publicKey: chapters.publicKey })
      .from(chapters)
      .where(eq(chapters.seriesId, seriesId));
    expect(
      persistedChapters
        .map((item) => [item.number, item.publicKey] as const)
        .sort((left, right) => left[0] - right[0]),
    ).toEqual([
      [25, "25"],
      [26, "26"],
      [30, "30"],
    ]);
    const [batch] = await database.db
      .select()
      .from(chapterImportBatches)
      .where(eq(chapterImportBatches.id, response.json().batchId));
    expect(batch?.createdBy).toBe(ownerId);
    const batchItems = await database.db
      .select()
      .from(chapterImportItems)
      .where(eq(chapterImportItems.batchId, response.json().batchId));
    expect(batchItems).toHaveLength(3);
    expect(
      batchItems.find((item) => item.clientId === "item-26")?.errorCode,
    ).toBe("invalid-upload");
    expect(await database.db.select().from(uploads)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ originalFilename: "999.zip" }),
      ]),
    );

    const unrelated = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie: await login(unrelatedEmail) },
      payload: {
        items: [
          {
            clientId: "denied",
            chapterNumber: 40,
            filename: "40.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
        ],
      },
    });
    expect(unrelated.statusCode).toBe(403);
  });

  it("projects partial failure and atomically retries only the failed item", async () => {
    const ownerCookie = await login(ownerEmail);
    const unrelatedCookie = await login(unrelatedEmail);
    const seriesSlug = `retry-${randomUUID()}`;
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Retry Raven", slug: seriesSlug },
    });
    const seriesId = created.json().id as string;
    createdSeriesIds.push(seriesId);
    const other = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Other Raven", slug: `other-${randomUUID()}` },
    });
    const otherSeriesId = other.json().id as string;
    createdSeriesIds.push(otherSeriesId);

    const createdBatch = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie: ownerCookie },
      payload: {
        items: [25, 26, 30].map((chapterNumber) => ({
          clientId: `item-${chapterNumber}`,
          chapterNumber,
          filename: `${chapterNumber}.zip`,
          contentType: "application/zip",
          sizeBytes: 4,
        })),
      },
    });
    expect(createdBatch.statusCode).toBe(201);
    const batch = createdBatch.json() as {
      batchId: string;
      items: {
        itemId: string;
        clientId: string;
        chapterId: string;
        uploadId: string;
      }[];
    };
    const originalUploadIds = new Map(
      batch.items.map((item) => [item.clientId, item.uploadId]),
    );
    const storage = new MemoryStorage();
    let failNext = false;
    const extractor: ZipExtractorPort = {
      async inspect() {
        if (failNext) {
          failNext = false;
          throw new Error("invalid-test-zip");
        }
        return [processedImage];
      },
      readImage: () => Readable.from([Buffer.from("img!")]),
      dispose: async () => undefined,
    };
    const processor = new ChapterProcessingService(
      new DrizzleProcessingRepository(database.db),
      storage,
      extractor,
      { append: async () => undefined },
    );

    async function completeAndProcess(
      item: (typeof batch.items)[number],
      shouldFail = false,
    ) {
      const complete = await app.inject({
        method: "POST",
        url: `/chapters/${item.chapterId}/uploads/${item.uploadId}/complete`,
        headers: { cookie: ownerCookie },
      });
      expect(complete.statusCode).toBe(200);
      const [upload] = await database.db
        .select({ storageKey: uploads.storageKey })
        .from(uploads)
        .where(eq(uploads.id, item.uploadId));
      if (!upload) throw new Error("upload missing");
      failNext = shouldFail;
      const processing = processor.process(
        {
          chapterId: item.chapterId,
          seriesId,
          uploadId: item.uploadId,
          sourceStorageKey: upload.storageKey,
        },
        shouldFail,
      );
      if (shouldFail)
        await expect(processing).rejects.toThrow("invalid-test-zip");
      else await processing;
    }

    const item25 = batch.items.find((item) => item.clientId === "item-25");
    const item26 = batch.items.find((item) => item.clientId === "item-26");
    const item30 = batch.items.find((item) => item.clientId === "item-30");
    if (!item25 || !item26 || !item30) throw new Error("batch items missing");
    await completeAndProcess(item25);
    await completeAndProcess(item26, true);
    await completeAndProcess(item30);

    const partial = await app.inject({
      method: "GET",
      url: `/import-batches/${batch.batchId}`,
      headers: { cookie: ownerCookie },
    });
    expect(partial.statusCode).toBe(200);
    expect(partial.json()).toMatchObject({
      status: "completed_with_errors",
      items: [
        { clientId: "item-25", status: "ready" },
        {
          clientId: "item-26",
          status: "failed",
          errorCode: "processing-failed",
        },
        { clientId: "item-30", status: "ready" },
      ],
    });
    const failed = item26;
    const retryUrl = `/series/${seriesId}/import-batches/${batch.batchId}/items/${failed.itemId}/retry`;

    const denied = await app.inject({
      method: "POST",
      url: retryUrl,
      headers: { cookie: unrelatedCookie },
      payload: { contentType: "application/zip", sizeBytes: 4 },
    });
    expect(denied.statusCode).toBe(403);
    const wrongSeries = await app.inject({
      method: "POST",
      url: `/series/${otherSeriesId}/import-batches/${batch.batchId}/items/${failed.itemId}/retry`,
      headers: { cookie: ownerCookie },
      payload: { contentType: "application/zip", sizeBytes: 4 },
    });
    expect(wrongSeries.statusCode).toBe(404);
    const clientAuthority = await app.inject({
      method: "POST",
      url: retryUrl,
      headers: { cookie: ownerCookie },
      payload: {
        contentType: "application/zip",
        sizeBytes: 4,
        uploadId: randomUUID(),
      },
    });
    expect(clientAuthority.statusCode).toBe(422);

    const concurrent = await Promise.all([
      app.inject({
        method: "POST",
        url: retryUrl,
        headers: { cookie: ownerCookie },
        payload: { contentType: "application/zip", sizeBytes: 4 },
      }),
      app.inject({
        method: "POST",
        url: retryUrl,
        headers: { cookie: ownerCookie },
        payload: { contentType: "application/zip", sizeBytes: 4 },
      }),
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    const successfulRetry = concurrent.find(
      (response) => response.statusCode === 201,
    );
    if (!successfulRetry) throw new Error("successful retry missing");
    const retried = successfulRetry.json() as (typeof batch.items)[number];
    expect(retried.uploadId).not.toBe(failed.uploadId);
    await completeAndProcess(retried);

    const completed = await app.inject({
      method: "GET",
      url: `/import-batches/${batch.batchId}`,
      headers: { cookie: ownerCookie },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      status: "completed",
      items: [
        { clientId: "item-25", status: "ready" },
        { clientId: "item-26", status: "ready", errorCode: null },
        { clientId: "item-30", status: "ready" },
      ],
    });
    expect(
      completed
        .json()
        .items.find((item: { clientId: string }) => item.clientId === "item-26")
        ?.itemId,
    ).toBe(failed.itemId);
    expect(
      completed
        .json()
        .items.filter((item: { clientId: string }) =>
          ["item-25", "item-30"].includes(item.clientId),
        )
        .map((item: { clientId: string; uploadId: string }) => [
          item.clientId,
          item.uploadId,
        ]),
    ).toEqual([
      ["item-25", originalUploadIds.get("item-25")],
      ["item-30", originalUploadIds.get("item-30")],
    ]);
    const readyRetry = await app.inject({
      method: "POST",
      url: retryUrl,
      headers: { cookie: ownerCookie },
      payload: { contentType: "application/zip", sizeBytes: 4 },
    });
    expect(readyRetry.statusCode).toBe(409);
    const uploadHistory = await database.db
      .select({ id: uploads.id })
      .from(uploads)
      .where(eq(uploads.chapterId, failed.chapterId));
    expect(uploadHistory).toHaveLength(2);
    const publishedKeys = await database.db
      .select({ storageKey: images.storageKey })
      .from(images)
      .where(
        inArray(
          images.chapterId,
          batch.items.map((item) => item.chapterId),
        ),
      );
    expect(publishedKeys.map((row) => row.storageKey).sort()).toEqual([
      `Media/${seriesSlug}/25/01.jpg`,
      `Media/${seriesSlug}/26/01.jpg`,
      `Media/${seriesSlug}/30/01.jpg`,
    ]);
  });
});
