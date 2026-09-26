import "dotenv/config";
import {
  expect,
  request,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { loadDatabaseConfig } from "@nodeprox/config";
import { and, desc, eq, inArray } from "drizzle-orm";
import { createDatabase } from "../../database/client.js";
import {
  chapters,
  chapterProcessingAttempts,
  images,
  series,
  uploads,
} from "../../database/schema/index.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { AdminBootstrapService } from "../../apps/api/src/modules/authorization/application/services/admin-bootstrap.service.js";
import { DrizzleAdminBootstrapStore } from "../../apps/api/src/modules/authorization/infrastructure/bootstrap/drizzle-admin-bootstrap.store.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const e2eApiOrigin = "http://127.0.0.1:3101";

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const crc = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const localEntry = Buffer.concat([header, name, entry.data]);
    local.push(localEntry);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(entry.data.length, 20);
    directory.writeUInt32LE(entry.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([directory, name]));
    offset += localEntry.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

const validZip = zipStored([
  { name: "24/03.webp", data: webp },
  { name: "24/01.jpg", data: jpeg },
  { name: "24/04.gif", data: gif },
  { name: "24/02.png", data: png },
]);

async function pollStatus(
  db: ReturnType<typeof createDatabase>["db"],
  chapterId: string,
  expected: "ready" | "failed",
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const [chapter] = await db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    if (chapter?.status === expected) return;
    if (chapter?.status === "ready" || chapter?.status === "failed") {
      const [attempt] = await db
        .select()
        .from(chapterProcessingAttempts)
        .where(eq(chapterProcessingAttempts.chapterId, chapterId))
        .orderBy(desc(chapterProcessingAttempts.attemptNumber))
        .limit(1);
      throw new Error(
        `unexpected final chapter status: ${JSON.stringify({
          chapterId,
          chapterStatus: chapter.status,
          processingAttemptId: attempt?.id ?? null,
          attemptStatus: attempt?.status ?? null,
          errorCode: attempt?.errorCode ?? null,
          errorMessage: attempt?.errorMessage ?? null,
          jobId: attempt?.jobId ?? null,
          uploadId: attempt?.uploadId ?? null,
        })}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for chapter ${expected}`);
}

async function pollUntil(
  predicate: () => Promise<boolean>,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for ${description}`);
}

async function createTestAdmin(database: ReturnType<typeof createDatabase>) {
  const email = `m4b-e2e-${randomBytes(12).toString("hex")}@example.test`;
  const password = randomBytes(24).toString("hex");
  await new AdminBootstrapService(
    new DrizzleAdminBootstrapStore(database.db),
    new Argon2PasswordHasher(),
  ).run({ email, password });
  return { email, password };
}

async function login(
  api: APIRequestContext,
  credentials: { email: string; password: string },
): Promise<APIRequestContext> {
  const response = await api.post("/auth/login", {
    data: credentials,
    headers: { origin: e2eApiOrigin },
  });
  expect(response.status()).toBe(204);
  const setCookie = response.headers()["set-cookie"];
  const token = /^nodeprox_session=([^;]+)/.exec(setCookie ?? "")?.[1];
  if (!token) throw new Error("authentication session cookie was not issued");
  const authenticated = await request.newContext({
    baseURL: e2eApiOrigin,
    extraHTTPHeaders: { cookie: `nodeprox_session=${token}` },
  });
  await api.dispose();
  const session = await authenticated.get("/auth/session");
  expect(session.status()).toBe(200);
  return authenticated;
}

async function directUpload(
  api: APIRequestContext,
  chapterId: string,
  filename: string,
  bytes: Buffer,
  contentType = "application/zip",
) {
  const initiated = await api.post(`/chapters/${chapterId}/uploads/initiate`, {
    data: {
      filename,
      contentType,
      sizeBytes: bytes.length,
    },
    headers: { origin: e2eApiOrigin },
  });
  if (initiated.status() !== 201)
    throw new Error(
      `initiate failed: ${initiated.status()} ${await initiated.text()}`,
    );
  const payload = await initiated.json();
  expect(payload.status).toBe("pending");
  expect(payload.transfer.mode).toBe("single");
  const direct = await request.newContext();
  try {
    const stored = await direct.put(payload.transfer.url, {
      data: bytes,
      headers: payload.transfer.headers,
    });
    expect(stored.status()).toBe(200);
  } finally {
    await direct.dispose();
  }
  return api.post(
    `/chapters/${chapterId}/uploads/${payload.uploadId}/complete`,
    { headers: { origin: e2eApiOrigin } },
  );
}

async function putGrantedUpload(
  api: APIRequestContext,
  item: {
    chapterId: string;
    uploadId: string;
    transfer: {
      url: string;
      headers: Record<string, string>;
    };
  },
  bytes: Buffer,
) {
  const direct = await request.newContext();
  try {
    const stored = await direct.put(item.transfer.url, {
      data: bytes,
      headers: item.transfer.headers,
    });
    expect(stored.status()).toBe(200);
  } finally {
    await direct.dispose();
  }
  const completed = await api.post(
    `/chapters/${item.chapterId}/uploads/${item.uploadId}/complete`,
    { headers: { origin: e2eApiOrigin } },
  );
  expect(completed.status()).toBe(200);
}

test.describe("M4-B real upload processing", () => {
  test("keeps bulk items independent and persistently retries only the failed item", async () => {
    let api = await request.newContext({ baseURL: e2eApiOrigin });
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const slug = `e2e-bulk-${Date.now()}`;
    let seriesId = "";
    const chapterIds: string[] = [];
    try {
      api = await login(api, await createTestAdmin(database));
      const createdSeries = await api.post("/series", {
        data: { title: "M4-B E2E bulk", slug },
        headers: { origin: e2eApiOrigin },
      });
      expect(createdSeries.status()).toBe(201);
      seriesId = (await createdSeries.json()).id;
      const createdBatch = await api.post(
        `/series/${seriesId}/import-batches`,
        {
          data: {
            items: [25, 26, 30].map((chapterNumber) => ({
              clientId: `e2e-${chapterNumber}`,
              chapterNumber,
              filename: `${chapterNumber}.zip`,
              contentType: "application/zip",
              sizeBytes: chapterNumber === 26 ? 11 : validZip.length,
            })),
          },
          headers: { origin: e2eApiOrigin },
        },
      );
      if (createdBatch.status() !== 201)
        throw new Error(
          `batch create failed: ${createdBatch.status()} ${await createdBatch.text()}`,
        );
      const batch = (await createdBatch.json()) as {
        batchId: string;
        items: Array<{
          itemId: string;
          clientId: string;
          chapterId: string;
          uploadId: string;
          transfer: { url: string; headers: Record<string, string> };
        }>;
      };
      chapterIds.push(...batch.items.map((item) => item.chapterId));
      const originalUploadIds = new Map(
        batch.items.map((item) => [item.clientId, item.uploadId]),
      );
      const item25 = batch.items.find((item) => item.clientId === "e2e-25");
      const item26 = batch.items.find((item) => item.clientId === "e2e-26");
      const item30 = batch.items.find((item) => item.clientId === "e2e-30");
      if (!item25 || !item26 || !item30)
        throw new Error("bulk response omitted an item");
      await Promise.all(
        batch.items.map((item) =>
          putGrantedUpload(
            api,
            item,
            item.clientId === "e2e-26"
              ? Buffer.from([
                  0x50, 0x4b, 0x03, 0x04, 0x69, 0x6e, 0x76, 0x61, 0x6c, 0x69,
                  0x64,
                ])
              : validZip,
          ),
        ),
      );
      await Promise.all([
        pollStatus(database.db, item25.chapterId, "ready"),
        pollStatus(database.db, item26.chapterId, "failed"),
        pollStatus(database.db, item30.chapterId, "ready"),
      ]);
      type BatchProjection = {
        status: string;
        items: Array<{
          itemId: string;
          clientId: string;
          chapterId: string;
          uploadId: string;
          status: string;
        }>;
      };
      await pollUntil(async () => {
        const response = await api.get(`/import-batches/${batch.batchId}`);
        const current = (await response.json()) as BatchProjection;
        return current.status === "completed_with_errors";
      }, "bulk completed_with_errors projection");
      const partialResponse = await api.get(`/import-batches/${batch.batchId}`);
      const projected = (await partialResponse.json()) as BatchProjection;
      expect(
        projected.items.map((item) => [item.clientId, item.status]),
      ).toEqual([
        ["e2e-25", "ready"],
        ["e2e-26", "failed"],
        ["e2e-30", "ready"],
      ]);
      const failed = projected.items.find((item) => item.clientId === "e2e-26");
      if (!failed) throw new Error("failed batch item missing");
      const retriedResponse = await api.post(
        `/series/${seriesId}/import-batches/${batch.batchId}/items/${failed.itemId}/retry`,
        {
          data: {
            contentType: "application/zip",
            sizeBytes: validZip.length,
          },
          headers: { origin: e2eApiOrigin },
        },
      );
      expect(retriedResponse.status()).toBe(201);
      const retried = await retriedResponse.json();
      expect(retried.uploadId).not.toBe(failed.uploadId);
      await putGrantedUpload(api, retried, validZip);
      await pollStatus(database.db, failed.chapterId, "ready");
      await pollUntil(async () => {
        const response = await api.get(`/import-batches/${batch.batchId}`);
        const current = (await response.json()) as BatchProjection;
        return current.status === "completed";
      }, "bulk completed projection");
      const completedResponse = await api.get(
        `/import-batches/${batch.batchId}`,
      );
      const completed = (await completedResponse.json()) as BatchProjection;
      expect(
        completed.items.map((item) => [item.clientId, item.status]),
      ).toEqual([
        ["e2e-25", "ready"],
        ["e2e-26", "ready"],
        ["e2e-30", "ready"],
      ]);
      expect(
        completed.items
          .filter((item) => item.clientId !== "e2e-26")
          .map((item) => item.uploadId),
      ).toEqual([
        originalUploadIds.get("e2e-25"),
        originalUploadIds.get("e2e-30"),
      ]);
    } finally {
      const persistedChapters = seriesId
        ? await database.db
            .select({ id: chapters.id })
            .from(chapters)
            .where(eq(chapters.seriesId, seriesId))
        : [];
      const cleanupChapterIds = [
        ...new Set([
          ...chapterIds,
          ...persistedChapters.map((chapter) => chapter.id),
        ]),
      ];
      if (cleanupChapterIds.length) {
        await database.db
          .delete(images)
          .where(inArray(images.chapterId, cleanupChapterIds));
        await database.db
          .delete(uploads)
          .where(inArray(uploads.chapterId, cleanupChapterIds));
        await database.db
          .delete(chapters)
          .where(inArray(chapters.id, cleanupChapterIds));
      }
      if (seriesId)
        await database.db.delete(series).where(eq(series.id, seriesId));
      await database.sql.end();
      await api.dispose();
    }
  });

  test("processes a valid ZIP through API, outbox, BullMQ and Worker", async () => {
    let api = await request.newContext({ baseURL: e2eApiOrigin });
    let anonymous: APIRequestContext | undefined;
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const slug = `e2e-valid-${Date.now()}`;
    let seriesId = "";
    let chapterId = "";
    try {
      api = await login(api, await createTestAdmin(database));
      const createdSeries = await api.post("/series", {
        data: { title: "M4-B E2E valid", slug },
        headers: { origin: e2eApiOrigin },
      });
      expect(createdSeries.status()).toBe(201);
      seriesId = (await createdSeries.json()).id;
      const createdChapter = await api.post(`/series/${seriesId}/chapters`, {
        data: { chapterNumber: 1, title: "Valid ZIP" },
        headers: { origin: e2eApiOrigin },
      });
      expect(createdChapter.status()).toBe(201);
      chapterId = (await createdChapter.json()).id;

      const uploaded = await directUpload(
        api,
        chapterId,
        "24.zip",
        validZip,
        "application/x-zip-compressed",
      );
      if (uploaded.status() !== 200)
        throw new Error(
          `upload failed: ${uploaded.status()} ${await uploaded.text()}`,
        );
      expect((await uploaded.json()).status).toBe("uploaded");

      await pollStatus(database.db, chapterId, "ready");
      const rows = await database.db
        .select()
        .from(images)
        .where(eq(images.chapterId, chapterId));
      expect(rows).toHaveLength(4);
      expect(
        rows
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((row) => row.filename),
      ).toEqual(["01.jpg", "02.png", "03.webp", "04.gif"]);
      expect(rows.map((row) => row.sortOrder).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4,
      ]);
      expect(
        rows.every(
          (row) =>
            row.storageKey === `Media/${slug}/1/${row.filename}`,
        ),
      ).toBe(true);
      expect(
        rows.every((row) => row.sizeBytes > 0 && row.checksum.length === 64),
      ).toBe(true);
      const [completedUpload] = await database.db
        .select({ storageKey: uploads.storageKey })
        .from(uploads)
        .where(eq(uploads.chapterId, chapterId));
      if (!completedUpload) throw new Error("expected completed upload");
      expect(
        existsSync(
          `${process.cwd()}/.nodeprox-storage/${completedUpload.storageKey}`,
        ),
      ).toBe(false);

      anonymous = await request.newContext({
        baseURL: e2eApiOrigin,
      });
      const publicChapter = await anonymous.get(
        `/public/chapters/${chapterId}`,
      );
      expect(publicChapter.status()).toBe(200);
      const publicPayload = await publicChapter.json();
      expect(publicPayload.id).toBe(chapterId);
      expect(
        publicPayload.images.map(
          (image: { filename: string }) => image.filename,
        ),
      ).toEqual(["01.jpg", "02.png", "03.webp", "04.gif"]);
      expect(
        publicPayload.images.every(
          (image: { url: string; filename: string }) =>
            image.url ===
            `https://media.nodeprox.org/${slug}/1/${image.filename}`,
        ),
      ).toBe(true);
      expect(
        publicPayload.images.every(
          (image: { storageKey?: string }) => !image.storageKey,
        ),
      ).toBe(true);

      const listed = await api.get(`/chapters/${chapterId}/images`);
      expect(listed.status()).toBe(200);
      const listedImages = (await listed.json()).images as Array<{
        id: string;
        filename: string;
        sortOrder: number;
        storageKey?: string;
      }>;
      expect(listedImages.map((image) => image.filename)).toEqual([
        "01.jpg",
        "02.png",
        "03.webp",
        "04.gif",
      ]);
      expect(listedImages.map((image) => image.sortOrder)).toEqual([
        1, 2, 3, 4,
      ]);
      expect(listedImages.every((image) => !image.storageKey)).toBe(true);

      const first = listedImages[0];
      if (!first) throw new Error("expected first image");
      const metadata = await api.get(`/images/${first.id}`);
      expect(metadata.status()).toBe(200);
      expect((await metadata.json()).storageKey).toBeUndefined();

      const content = await api.get(`/images/${first.id}/content`);
      expect(content.status()).toBe(200);
      expect(content.headers()["content-type"]).toContain("image/jpeg");
      expect(Number(content.headers()["content-length"])).toBeGreaterThan(0);
      expect((await content.body()).length).toBeGreaterThan(0);

      const webpImage = listedImages.find(
        (image) => image.filename === "03.webp",
      );
      if (!webpImage) throw new Error("expected WebP image");
      const webpContent = await api.get(`/images/${webpImage.id}/content`);
      expect(webpContent.status()).toBe(200);
      expect(webpContent.headers()["content-type"]).toContain("image/webp");
      expect(await webpContent.body()).toEqual(webp);

    } finally {
      if (chapterId) {
        await database.db.delete(images).where(eq(images.chapterId, chapterId));
        await database.db
          .delete(uploads)
          .where(eq(uploads.chapterId, chapterId));
        await database.db.delete(chapters).where(eq(chapters.id, chapterId));
      }
      if (seriesId)
        await database.db.delete(series).where(eq(series.id, seriesId));
      await database.sql.end();
      await api.dispose();
      await anonymous?.dispose();
    }
  });

  test("marks an invalid ZIP failed and cleans partial processing state", async () => {
    let api = await request.newContext({ baseURL: e2eApiOrigin });
    let anonymous: APIRequestContext | undefined;
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const slug = `e2e-invalid-${Date.now()}`;
    let seriesId = "";
    let chapterId = "";
    try {
      api = await login(api, await createTestAdmin(database));
      const createdSeries = await api.post("/series", {
        data: { title: "M4-B E2E invalid", slug },
        headers: { origin: e2eApiOrigin },
      });
      seriesId = (await createdSeries.json()).id;
      const createdChapter = await api.post(`/series/${seriesId}/chapters`, {
        data: { chapterNumber: 1 },
        headers: { origin: e2eApiOrigin },
      });
      chapterId = (await createdChapter.json()).id;
      anonymous = await request.newContext({
        baseURL: e2eApiOrigin,
      });
      const notReady = await anonymous.get(`/public/chapters/${chapterId}`);
      expect(notReady.status()).toBe(404);
      const uploaded = await directUpload(
        api,
        chapterId,
        "invalid.zip",
        Buffer.from([
          0x50, 0x4b, 0x03, 0x04, 0x69, 0x6e, 0x76, 0x61, 0x6c, 0x69, 0x64,
        ]),
      );
      if (uploaded.status() !== 200)
        throw new Error(
          `upload failed: ${uploaded.status()} ${await uploaded.text()}`,
        );
      await pollStatus(database.db, chapterId, "failed");
      const rows = await database.db
        .select()
        .from(images)
        .where(eq(images.chapterId, chapterId));
      expect(rows).toHaveLength(0);
      const [upload] = await database.db
        .select({ storageKey: uploads.storageKey })
        .from(uploads)
        .where(
          and(eq(uploads.chapterId, chapterId), eq(uploads.status, "uploaded")),
        );
      if (!upload) throw new Error("uploaded record was not found");
      await pollUntil(
        async () =>
          !existsSync(
            `${process.cwd()}/.nodeprox-storage/${upload.storageKey}`,
          ),
        "invalid ZIP cleanup after processing retries",
      );
    } finally {
      if (chapterId) {
        await database.db.delete(images).where(eq(images.chapterId, chapterId));
        await database.db
          .delete(uploads)
          .where(eq(uploads.chapterId, chapterId));
        await database.db.delete(chapters).where(eq(chapters.id, chapterId));
      }
      if (seriesId)
        await database.db.delete(series).where(eq(series.id, seriesId));
      rmSync(
        `${process.cwd()}/.nodeprox-storage/Media/${slug}/1`,
        { recursive: true, force: true },
      );
      await database.sql.end();
      await api.dispose();
      await anonymous?.dispose();
    }
  });
});
