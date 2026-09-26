import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { ChapterProcessingService } from "../../apps/worker/src/processing/application/chapter-processing.service.js";
import type { ZipExtractorPort } from "../../apps/worker/src/processing/application/ports.js";
import type { ValidatedImage } from "../../apps/worker/src/processing/domain/image-policy.js";
import { DrizzleProcessingRepository } from "../../apps/worker/src/processing/infrastructure/persistence/drizzle/processing.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterImportBatches,
  chapterImportItems,
  chapters,
  images,
  processingOutbox,
  series,
  seriesAssignments,
  uploads,
  users,
} from "../../database/schema/index.js";
import type {
  StoragePort,
  UploadTransferPort,
} from "../../packages/storage/src/port.js";
import {
  FakeDiscordSeriesChannelGateway,
  withM2DSeriesFixtures,
} from "./helpers/discord-series-channel-fixture.js";

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
  readonly objects = new Map<string, Buffer>();
  async put(input: {
    key: string;
    body: NodeJS.ReadableStream;
    sizeBytes: number;
    contentType: string;
  }) {
    const chunks: Buffer[] = [];
    for await (const chunk of input.body) chunks.push(Buffer.from(chunk));
    this.keys.add(input.key);
    this.objects.set(input.key, Buffer.concat(chunks));
    return {
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
    };
  }
  async get(key: string) {
    this.keys.add(key);
    return Readable.from([this.objects.get(key) ?? Buffer.from("zip!")]);
  }
  async delete(key: string) {
    this.keys.delete(key);
    this.objects.delete(key);
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
  checksum: createHash("sha256").update("img!").digest("hex"),
  warnings: [],
  tempPath: "batch-image",
};

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const transfer = new FakeTransfer();
const app = withM2DSeriesFixtures(
  buildApp(
    { logger: false },
    {
      database: database.db,
      secureCookie: false,
      storage: { provider: "filesystem", uploadMaxSizeBytes: 1024 },
      uploadTransfer: transfer,
      seriesChannelGateway: new FakeDiscordSeriesChannelGateway(),
    },
  ),
);
const ownerId = randomUUID();
const unrelatedId = randomUUID();
const supportGestorId = randomUUID();
const ownerEmail = `batch-owner-${ownerId}@example.test`;
const unrelatedEmail = `batch-unrelated-${unrelatedId}@example.test`;
const supportGestorEmail = `batch-support-${supportGestorId}@example.test`;
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
    {
      id: supportGestorId,
      email: supportGestorEmail,
      passwordHash,
      status: "active",
      role: "gestor",
    },
  ]);
});

describe("ChapterImportBatch admission control", () => {
  it("accepts exactly fifteen items", async () => {
    const cookie = await login(ownerEmail);
    const seriesId = await createSeries(cookie, "Fifteen items");
    const response = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie },
      payload: {
        items: Array.from({ length: 15 }, (_, index) => ({
          clientId: `accepted-${index}`,
          chapterNumber: index,
          filename: `${index}.zip`,
          contentType: "application/zip",
          sizeBytes: 4,
        })),
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().items).toHaveLength(15);

    const uploadCenter = await app.inject({
      method: "GET",
      url: "/me/upload-operations?limit=20",
      headers: { cookie },
    });
    expect(uploadCenter.statusCode, uploadCenter.body).toBe(200);
    expect(uploadCenter.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "chapter_import",
          seriesId,
          filename: "0.zip",
          status: "uploading",
        }),
      ]),
    );
    expect(
      (await app.inject({ method: "GET", url: "/me/upload-operations" }))
        .statusCode,
    ).toBe(401);
  });

  it("rejects a sixteenth item and an item over the server hard limit", async () => {
    const cookie = await login(ownerEmail);
    const seriesId = await createSeries(cookie, "Admission limits");
    const items = Array.from({ length: 16 }, (_, index) => ({
      clientId: `too-many-${index}`,
      chapterNumber: 100 + index,
      filename: `${index}.zip`,
      contentType: "application/zip",
      sizeBytes: 4,
    }));
    const tooMany = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie },
      payload: { items },
    });
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json()).toMatchObject({ code: "bulk-item-limit" });

    const tooLarge = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie },
      payload: {
        items: [
          {
            clientId: "too-large",
            chapterNumber: 200,
            filename: "large.zip",
            contentType: "application/zip",
            sizeBytes: 1025,
          },
        ],
      },
    });
    expect(tooLarge.statusCode).toBe(422);
    expect(tooLarge.json()).toMatchObject({ code: "bulk-item-size-limit" });
  });

  it("enforces active Series and items without counting another batch in the same Series twice", async () => {
    const cookie = await login(ownerEmail);
    const first = await createSeries(cookie, "Active A");
    const second = await createSeries(cookie, "Active B");
    const third = await createSeries(cookie, "Active C");
    const fourth = await createSeries(cookie, "Active D");
    await Promise.all([
      seedActiveBatch(first, 1),
      seedActiveBatch(second, 1),
      seedActiveBatch(third, 1),
    ]);
    const sameSeries = await app.inject({
      method: "POST",
      url: `/series/${first}/import-batches`,
      headers: { cookie },
      payload: { items: [candidate("same-series", 300)] },
    });
    expect(sameSeries.statusCode, sameSeries.body).toBe(201);
    const blocked = await app.inject({
      method: "POST",
      url: `/series/${fourth}/import-batches`,
      headers: { cookie },
      payload: { items: [candidate("fourth-series", 301)] },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "bulk-active-series-limit" });
  });

  it("serializes concurrent reservations so active item capacity is never exceeded", async () => {
    const cookie = await login(ownerEmail);
    const seriesId = await createSeries(cookie, "Concurrent capacity");
    await seedActiveBatch(seriesId, 30);
    const payload = (prefix: string) => ({
      items: Array.from({ length: 10 }, (_, index) =>
        candidate(`${prefix}-${index}`, 400 + index),
      ),
    });
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/series/${seriesId}/import-batches`,
        headers: { cookie },
        payload: payload("first"),
      }),
      app.inject({
        method: "POST",
        url: `/series/${seriesId}/import-batches`,
        headers: { cookie },
        payload: payload("second"),
      }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json(),
    ).toMatchObject({ code: "bulk-active-item-limit" });
  });

  it("rejects a forty-sixth active item", async () => {
    const cookie = await login(ownerEmail);
    const seriesId = await createSeries(cookie, "Full active capacity");
    await seedActiveBatch(seriesId, 45);
    const response = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie },
      payload: { items: [candidate("forty-six", 500)] },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "bulk-active-item-limit" });
  });
});

afterEach(async () => {
  const ids = createdSeriesIds.splice(0);
  await cleanupSeries(ids);
});

afterAll(async () => {
  await cleanupSeries(createdSeriesIds.splice(0));
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, [ownerId, unrelatedId, supportGestorId]));
  await database.db
    .delete(users)
    .where(inArray(users.id, [ownerId, unrelatedId, supportGestorId]));
  await app.close();
  await database.sql.end();
});

async function cleanupSeries(seriesIds: readonly string[]) {
  if (!seriesIds.length) return;
  const createdChapters = await database.db
    .select({ id: chapters.id })
    .from(chapters)
    .where(inArray(chapters.seriesId, seriesIds));
  await database.db
    .delete(chapterImportBatches)
    .where(inArray(chapterImportBatches.seriesId, seriesIds));
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
    await database.db.delete(chapters).where(inArray(chapters.id, chapterIds));
  }
  await database.db.delete(series).where(inArray(series.id, seriesIds));
}

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

async function createSeries(cookie: string, title: string) {
  const response = await app.inject({
    method: "POST",
    url: "/series",
    headers: { cookie },
    payload: { title, slug: `bulk-${randomUUID()}` },
  });
  expect(response.statusCode, response.body).toBe(201);
  const seriesId = response.json().id as string;
  createdSeriesIds.push(seriesId);
  return seriesId;
}

async function createChapter(
  cookie: string,
  seriesId: string,
  chapterNumber: number,
) {
  const response = await app.inject({
    method: "POST",
    url: `/series/${seriesId}/chapters`,
    headers: { cookie },
    payload: { chapterNumber },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: string; chapterNumber: number };
}

function candidate(clientId: string, chapterNumber: number) {
  return {
    clientId,
    chapterNumber,
    filename: `${chapterNumber}.zip`,
    contentType: "application/zip",
    sizeBytes: 4,
  };
}

async function seedActiveBatch(seriesId: string, count: number) {
  const batchId = randomUUID();
  await database.db.insert(chapterImportBatches).values({
    id: batchId,
    seriesId,
    createdBy: ownerId,
  });
  await database.db.insert(chapterImportItems).values(
    Array.from({ length: count }, (_, index) => ({
      batchId,
      clientId: `reserved-${batchId}-${index}`,
      chapterNumber: index,
      filename: `reserved-${index}.zip`,
      status: "pending" as const,
    })),
  );
}

describe("ChapterImportBatch metadata orchestration", () => {
  it("persists created, reused and conflict resolutions independently", async () => {
    const ownerCookie = await login(ownerEmail);
    const seriesId = await createSeries(ownerCookie, "Smart Bulk Raven");
    const reusable = await createChapter(ownerCookie, seriesId, 1.5);
    const processing = await createChapter(ownerCookie, seriesId, 2);
    await database.db
      .update(chapters)
      .set({ status: "processing" })
      .where(eq(chapters.id, processing.id));

    const response = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie: ownerCookie },
      payload: {
        items: [
          {
            clientId: "created-zero",
            chapterNumber: 0,
            filename: "not-authority.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
          {
            clientId: "reused-decimal",
            chapterNumber: 1.5,
            filename: "999.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
          {
            clientId: "processing-conflict",
            chapterNumber: 2,
            filename: "2.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
        ],
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().items).toEqual([
      expect.objectContaining({
        clientId: "created-zero",
        resolution: "created",
        status: "uploading",
      }),
      expect.objectContaining({
        clientId: "reused-decimal",
        chapterId: reusable.id,
        resolution: "reused",
        status: "uploading",
      }),
      expect.objectContaining({
        clientId: "processing-conflict",
        chapterId: processing.id,
        resolution: "conflict",
        status: "failed",
        errorCode: "chapter-processing",
      }),
    ]);

    const batchId = response.json().batchId as string;
    const persisted = await database.db
      .select()
      .from(chapterImportItems)
      .where(eq(chapterImportItems.batchId, batchId));
    expect(persisted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          clientId: "created-zero",
          targetResolution: "created",
          errorCode: null,
        }),
        expect.objectContaining({
          clientId: "reused-decimal",
          chapterId: reusable.id,
          targetResolution: "reused",
          errorCode: null,
        }),
        expect.objectContaining({
          clientId: "processing-conflict",
          chapterId: processing.id,
          targetResolution: "conflict",
          status: "failed",
          errorCode: "chapter-processing",
        }),
      ]),
    );
    const projected = await app.inject({
      method: "GET",
      url: `/import-batches/${batchId}`,
      headers: { cookie: ownerCookie },
    });
    expect(projected.statusCode).toBe(200);
    expect(
      projected
        .json()
        .items.map((item: { clientId: string; resolution: string | null }) => [
          item.clientId,
          item.resolution,
        ]),
    ).toEqual([
      ["created-zero", "created"],
      ["reused-decimal", "reused"],
      ["processing-conflict", "conflict"],
    ]);
    expect(
      persisted.filter((item) => item.chapterId === processing.id),
    ).toHaveLength(1);
    expect(
      await database.db
        .select({ id: uploads.id })
        .from(uploads)
        .where(eq(uploads.chapterId, processing.id)),
    ).toHaveLength(0);
  });

  it("serializes concurrent absent resolution to one Chapter and one active upload", async () => {
    const ownerCookie = await login(ownerEmail);
    const seriesId = await createSeries(ownerCookie, "Concurrent Smart Bulk");
    const payload = (clientId: string) => ({
      items: [
        {
          clientId,
          chapterNumber: 25.125,
          filename: `${clientId}.zip`,
          contentType: "application/zip",
          sizeBytes: 4,
        },
      ],
    });

    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/series/${seriesId}/import-batches`,
        headers: { cookie: ownerCookie },
        payload: payload("race-a"),
      }),
      app.inject({
        method: "POST",
        url: `/series/${seriesId}/import-batches`,
        headers: { cookie: ownerCookie },
        payload: payload("race-b"),
      }),
    ]);
    expect(responses.map((item) => item.statusCode)).toEqual([201, 201]);
    const results = responses.map((item) => item.json().items[0]);
    expect(
      results.filter((item) => item.resolution === "conflict"),
    ).toHaveLength(1);
    expect(["created", "reused"]).toContain(
      results.find((item) => item.resolution !== "conflict")?.resolution,
    );
    expect(
      results.find((item) => item.resolution === "conflict"),
    ).toMatchObject({
      status: "failed",
      errorCode: "chapter-upload-active",
    });
    const chapterRows = await database.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(eq(chapters.seriesId, seriesId));
    expect(chapterRows).toHaveLength(1);
    const uploadRows = await database.db
      .select({ id: uploads.id })
      .from(uploads)
      .where(eq(uploads.chapterId, chapterRows[0]?.id ?? ""));
    expect(uploadRows).toHaveLength(1);
  });

  it("allows only one upload when two requests concurrently reuse a draft", async () => {
    const ownerCookie = await login(ownerEmail);
    const seriesId = await createSeries(ownerCookie, "Concurrent Reuse");
    const chapter = await createChapter(ownerCookie, seriesId, 1.5);
    const request = (clientId: string) =>
      app.inject({
        method: "POST",
        url: `/series/${seriesId}/import-batches`,
        headers: { cookie: ownerCookie },
        payload: {
          items: [
            {
              clientId,
              chapterNumber: 1.5,
              filename: `${clientId}.zip`,
              contentType: "application/zip",
              sizeBytes: 4,
            },
          ],
        },
      });

    const responses = await Promise.all([
      request("reuse-a"),
      request("reuse-b"),
    ]);
    expect(responses.map((item) => item.statusCode)).toEqual([201, 201]);
    const results = responses.map((item) => item.json().items[0]);
    expect(results.map((item) => item.resolution).sort()).toEqual([
      "conflict",
      "reused",
    ]);
    expect(results.every((item) => item.chapterId === chapter.id)).toBe(true);
    expect(
      await database.db
        .select({ id: uploads.id })
        .from(uploads)
        .where(eq(uploads.chapterId, chapter.id)),
    ).toHaveLength(1);
  });

  it("allows a Gestor to resolve a foreign Chapter without changing ownership", async () => {
    const ownerCookie = await login(ownerEmail);
    const supportCookie = await login(supportGestorEmail);
    const seriesId = await createSeries(ownerCookie, "Foreign Smart Bulk");
    const response = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie: supportCookie },
      payload: {
        items: [
          {
            clientId: "foreign-gestor",
            chapterNumber: 0.5,
            filename: "foreign.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
        ],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json().items[0]).toMatchObject({
      resolution: "created",
      status: "uploading",
    });
    const [persistedSeries] = await database.db
      .select({ createdBy: series.createdBy })
      .from(series)
      .where(eq(series.id, seriesId));
    expect(persistedSeries?.createdBy).toBe(ownerId);
    expect(
      await database.db
        .select({ responsibleUserId: seriesAssignments.responsibleUserId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, seriesId)),
    ).toEqual([{ responsibleUserId: ownerId }]);
  });

  it("reresolves a conflict item to reused on retry", async () => {
    const ownerCookie = await login(ownerEmail);
    const seriesId = await createSeries(ownerCookie, "Retry Smart Target");
    const chapter = await createChapter(ownerCookie, seriesId, 5);
    const active = await app.inject({
      method: "POST",
      url: `/chapters/${chapter.id}/uploads/initiate`,
      headers: { cookie: ownerCookie },
      payload: {
        filename: "active.zip",
        contentType: "application/zip",
        sizeBytes: 4,
      },
    });
    expect(active.statusCode, active.body).toBe(201);

    const batch = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie: ownerCookie },
      payload: {
        items: [
          {
            clientId: "retry-conflict",
            chapterNumber: 5,
            filename: "5.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
        ],
      },
    });
    expect(batch.statusCode).toBe(201);
    expect(batch.json().items[0]).toMatchObject({
      chapterId: chapter.id,
      resolution: "conflict",
      errorCode: "chapter-upload-active",
    });

    const abort = await app.inject({
      method: "POST",
      url: `/chapters/${chapter.id}/uploads/${active.json().uploadId}/abort`,
      headers: { cookie: ownerCookie },
    });
    expect(abort.statusCode, abort.body).toBe(204);

    const item = batch.json().items[0] as { itemId: string };
    const retried = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches/${batch.json().batchId}/items/${item.itemId}/retry`,
      headers: { cookie: ownerCookie },
      payload: { contentType: "application/zip", sizeBytes: 4 },
    });
    expect(retried.statusCode, retried.body).toBe(201);
    expect(retried.json()).toMatchObject({
      chapterId: chapter.id,
      resolution: "reused",
      status: "uploading",
    });
    const [persisted] = await database.db
      .select({
        chapterId: chapterImportItems.chapterId,
        resolution: chapterImportItems.targetResolution,
        status: chapterImportItems.status,
        errorCode: chapterImportItems.errorCode,
      })
      .from(chapterImportItems)
      .where(eq(chapterImportItems.id, item.itemId));
    expect(persisted).toEqual({
      chapterId: chapter.id,
      resolution: "reused",
      status: "uploading",
      errorCode: null,
    });
  });

  it("reads historical null resolution and rejects invalid enum values", async () => {
    const ownerCookie = await login(ownerEmail);
    const seriesId = await createSeries(ownerCookie, "Historical Smart Bulk");
    const batchId = randomUUID();
    await database.db.insert(chapterImportBatches).values({
      id: batchId,
      seriesId,
      createdBy: ownerId,
    });
    const [historical] = await database.db
      .insert(chapterImportItems)
      .values({
        batchId,
        clientId: "historical-null",
        chapterNumber: 1,
        filename: "historical.zip",
        status: "failed",
        errorCode: "historical",
      })
      .returning({ id: chapterImportItems.id });
    const response = await app.inject({
      method: "GET",
      url: `/import-batches/${batchId}`,
      headers: { cookie: ownerCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      clientId: "historical-null",
      resolution: null,
    });
    await expect(
      database.db.execute(
        sql`update chapter_import_items set target_resolution = 'invalid' where id = ${historical?.id}`,
      ),
    ).rejects.toThrow();
  });

  it("creates independent direct-upload items and keeps chapterNumber explicit", async () => {
    const transferCountBefore = transfer.keys.length;
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
    expect(transfer.keys).toHaveLength(transferCountBefore + 2);

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
      batchItems.find((item) => item.clientId === "item-26"),
    ).toMatchObject({
      errorCode: "invalid-upload",
      targetResolution: "created",
      chapterId: expect.any(String),
    });
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

  it("accepts explicit decimal Chapter numbers independently of ZIP filenames", async () => {
    const ownerCookie = await login(ownerEmail);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: {
        title: "Decimal Bulk Raven",
        slug: `bulk-decimal-${randomUUID()}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const seriesId = created.json().id as string;
    createdSeriesIds.push(seriesId);

    const response = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/import-batches`,
      headers: { cookie: ownerCookie },
      payload: {
        items: [
          {
            clientId: "decimal-zero",
            chapterNumber: 0,
            filename: "not-the-number.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
          {
            clientId: "decimal-half",
            chapterNumber: 0.5,
            filename: "24.zip",
            contentType: "application/zip",
            sizeBytes: 4,
          },
        ],
      },
    });
    expect(response.statusCode, response.body).toBe(201);
    const persisted = await database.db
      .select({ number: chapters.chapterNumber })
      .from(chapters)
      .where(eq(chapters.seriesId, seriesId));
    expect(persisted.map((chapter) => chapter.number).sort()).toEqual([0, 0.5]);
    const persistedItems = await database.db
      .select({ number: chapterImportItems.chapterNumber })
      .from(chapterImportItems)
      .where(eq(chapterImportItems.batchId, response.json().batchId));
    expect(persistedItems.map((item) => item.number).sort()).toEqual([0, 0.5]);
  });

  it("projects partial failure and atomically retries only the failed item", async () => {
    const ownerCookie = await login(ownerEmail);
    const unrelatedCookie = await login(unrelatedEmail);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Retry Raven", slug: `retry-${randomUUID()}` },
    });
    const seriesId = created.json().id as string;
    const seriesSlug = created.json().slug as string;
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
        items: [25, 0.5, 30].map((chapterNumber) => ({
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
    const item26 = batch.items.find((item) => item.clientId === "item-0.5");
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
    expect(partial.json().status).toBe("completed_with_errors");
    const [failedChapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, item26.chapterId));
    expect(failedChapter?.status).toBe("failed");
    expect(partial.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: "item-25", status: "ready" }),
        expect.objectContaining({
          clientId: "item-0.5",
          status: "failed",
          errorCode: "ZIP_READ_FAILED",
        }),
        expect.objectContaining({ clientId: "item-30", status: "ready" }),
      ]),
    );
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
    expect(completed.json().status).toBe("completed");
    expect(completed.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ clientId: "item-25", status: "ready" }),
        expect.objectContaining({
          clientId: "item-0.5",
          status: "ready",
          errorCode: null,
        }),
        expect.objectContaining({ clientId: "item-30", status: "ready" }),
      ]),
    );
    expect(
      completed
        .json()
        .items.find(
          (item: { clientId: string }) => item.clientId === "item-0.5",
        )?.itemId,
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
      `Media/${seriesSlug}/0-5/01.jpg`,
      `Media/${seriesSlug}/25/01.jpg`,
      `Media/${seriesSlug}/30/01.jpg`,
    ]);
  });
});
