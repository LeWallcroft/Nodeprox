import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { loadDatabaseConfig } from "@nodeprox/config";
import {
  type APIRequestContext,
  expect,
  type Page,
  request,
  test,
} from "@playwright/test";
import { desc, eq, inArray } from "drizzle-orm";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { AdminBootstrapService } from "../../apps/api/src/modules/authorization/application/services/admin-bootstrap.service.js";
import { DrizzleAdminBootstrapStore } from "../../apps/api/src/modules/authorization/infrastructure/bootstrap/drizzle-admin-bootstrap.store.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterProcessingAttempts,
  chapters,
  images,
  processingOutbox,
  series,
  systemConfig,
  uploads,
  uploadValidationIssues,
  uploadValidationRuns,
} from "../../database/schema/index.js";

const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01,
  0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
]);
const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
]);
const webp = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
);
const gif = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
]);
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
  const [chapter] = await db
    .select({ status: chapters.status })
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  const [attempt] = await db
    .select()
    .from(chapterProcessingAttempts)
    .where(eq(chapterProcessingAttempts.chapterId, chapterId))
    .orderBy(desc(chapterProcessingAttempts.attemptNumber))
    .limit(1);
  throw new Error(
    `timed out waiting for chapter ${expected}: ${JSON.stringify({
      chapterId,
      chapterStatus: chapter?.status ?? null,
      attemptStatus: attempt?.status ?? null,
      errorCode: attempt?.errorCode ?? null,
      errorMessage: attempt?.errorMessage ?? null,
      jobId: attempt?.jobId ?? null,
      uploadId: attempt?.uploadId ?? null,
    })}`,
  );
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

async function pollUploadStatus(
  db: ReturnType<typeof createDatabase>["db"],
  uploadId: string,
  expected: "uploaded" | "rejected",
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const [upload] = await db
      .select({ status: uploads.status })
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    if (upload?.status === expected) return;
    if (
      expected === "uploaded" &&
      (upload?.status === "rejected" || upload?.status === "terminal_failed")
    ) {
      const [run] = await db
        .select({
          id: uploadValidationRuns.id,
          status: uploadValidationRuns.status,
        })
        .from(uploadValidationRuns)
        .where(eq(uploadValidationRuns.uploadId, uploadId))
        .orderBy(desc(uploadValidationRuns.attemptNumber))
        .limit(1);
      const issues = run
        ? await db
            .select({
              code: uploadValidationIssues.code,
              filename: uploadValidationIssues.filename,
            })
            .from(uploadValidationIssues)
            .where(eq(uploadValidationIssues.runId, run.id))
        : [];
      throw new Error(
        `upload did not pass admission: ${JSON.stringify({
          uploadStatus: upload.status,
          runStatus: run?.status ?? null,
          issues,
        })}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out waiting for upload ${expected}: ${uploadId}`);
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

async function authenticatePage(
  page: Page,
  credentials: { email: string; password: string },
) {
  const browserSession = await request.newContext({ baseURL: e2eApiOrigin });
  try {
    const browserLogin = await browserSession.post("/auth/login", {
      data: credentials,
      headers: { origin: e2eApiOrigin },
    });
    expect(browserLogin.status()).toBe(204);
    const browserToken = /^nodeprox_session=([^;]+)/.exec(
      browserLogin.headers()["set-cookie"] ?? "",
    )?.[1];
    if (!browserToken)
      throw new Error("browser authentication cookie was not issued");
    await page.context().addCookies([
      {
        name: "nodeprox_session",
        value: browserToken,
        url: "http://127.0.0.1:3100",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
  } finally {
    await browserSession.dispose();
  }
  await page.goto("/");
  await expect(
    page.getByRole("complementary", { name: "Navegación principal" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Notificaciones de cargas" }),
  ).toBeEmpty();
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
  test("resubmits only the rejected bulk item with a new transfer", async () => {
    test.setTimeout(90_000);
    let api = await request.newContext({ baseURL: e2eApiOrigin });
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const title = `M4-B E2E bulk ${Date.now()}`;
    let seriesId = "";
    const chapterIds: string[] = [];
    try {
      api = await login(api, await createTestAdmin(database));
      const createdSeries = await api.post("/series", {
        data: { title },
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
        pollUploadStatus(database.db, item26.uploadId, "rejected"),
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
        ["e2e-26", "rejected"],
        ["e2e-30", "ready"],
      ]);
      const failed = projected.items.find((item) => item.clientId === "e2e-26");
      if (!failed) throw new Error("failed batch item missing");
      const oldRejectedUploadId = failed.uploadId;
      const [oldRun] = await database.db
        .select({ id: uploadValidationRuns.id })
        .from(uploadValidationRuns)
        .where(eq(uploadValidationRuns.uploadId, oldRejectedUploadId))
        .orderBy(desc(uploadValidationRuns.attemptNumber))
        .limit(1);
      if (!oldRun) throw new Error("rejected upload validation run missing");
      const oldIssues = await database.db
        .select({ id: uploadValidationIssues.id })
        .from(uploadValidationIssues)
        .where(eq(uploadValidationIssues.runId, oldRun.id));
      expect(oldIssues.length).toBeGreaterThan(0);
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
      expect(retried.status).toBe("uploading");
      expect(retried.uploadId).not.toBe(oldRejectedUploadId);
      await putGrantedUpload(api, retried, validZip);
      await pollUploadStatus(database.db, retried.uploadId, "uploaded");
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
      const history = await database.db
        .select({ id: uploads.id, status: uploads.status })
        .from(uploads)
        .where(eq(uploads.chapterId, failed.chapterId));
      expect(history).toEqual(
        expect.arrayContaining([
          { id: oldRejectedUploadId, status: "rejected" },
          { id: retried.uploadId, status: "uploaded" },
        ]),
      );
      const [preservedRun] = await database.db
        .select({ status: uploadValidationRuns.status })
        .from(uploadValidationRuns)
        .where(eq(uploadValidationRuns.id, oldRun.id));
      expect(preservedRun?.status).toBe("rejected");
      expect(
        await database.db
          .select({ id: uploadValidationIssues.id })
          .from(uploadValidationIssues)
          .where(eq(uploadValidationIssues.runId, oldRun.id)),
      ).toEqual(oldIssues);
      expect(
        await database.db
          .select({ id: processingOutbox.id })
          .from(processingOutbox)
          .where(eq(processingOutbox.uploadId, oldRejectedUploadId)),
      ).toHaveLength(0);
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
    test.setTimeout(90_000);
    let api = await request.newContext({ baseURL: e2eApiOrigin });
    let anonymous: APIRequestContext | undefined;
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const title = `M4-B E2E valid ${Date.now()}`;
    let slug = "";
    let seriesId = "";
    let chapterId = "";
    try {
      api = await login(api, await createTestAdmin(database));
      const createdSeries = await api.post("/series", {
        data: { title },
        headers: { origin: e2eApiOrigin },
      });
      expect(createdSeries.status()).toBe(201);
      const createdSeriesBody = await createdSeries.json();
      seriesId = createdSeriesBody.id;
      slug = createdSeriesBody.slug;
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
      expect((await uploaded.json()).status).toBe("validating");
      const [pendingUpload] = await database.db
        .select({ id: uploads.id })
        .from(uploads)
        .where(eq(uploads.chapterId, chapterId));
      if (!pendingUpload) throw new Error("expected validating upload");
      await pollUploadStatus(database.db, pendingUpload.id, "uploaded");

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
          (row) => row.storageKey === `Media/${slug}/1/${row.filename}`,
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
      await pollUntil(
        async () =>
          !existsSync(
            `${process.cwd()}/.nodeprox-storage/${completedUpload.storageKey}`,
          ),
        "source ZIP cleanup after successful processing",
      );

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

  test("rejects an invalid ZIP during admission without processing it", async () => {
    test.setTimeout(90_000);
    let api = await request.newContext({ baseURL: e2eApiOrigin });
    let anonymous: APIRequestContext | undefined;
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const title = `M4-B E2E invalid ${Date.now()}`;
    let slug = "";
    let seriesId = "";
    let chapterId = "";
    try {
      api = await login(api, await createTestAdmin(database));
      const createdSeries = await api.post("/series", {
        data: { title },
        headers: { origin: e2eApiOrigin },
      });
      const createdSeriesBody = await createdSeries.json();
      seriesId = createdSeriesBody.id;
      slug = createdSeriesBody.slug;
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
      const [upload] = await database.db
        .select({ id: uploads.id, status: uploads.status })
        .from(uploads)
        .where(eq(uploads.chapterId, chapterId));
      if (!upload) throw new Error("invalid upload record was not found");
      await pollUploadStatus(database.db, upload.id, "rejected");
      const [rejectedChapter] = await database.db
        .select({ status: chapters.status })
        .from(chapters)
        .where(eq(chapters.id, chapterId));
      expect(rejectedChapter?.status).toBe("draft");
      const rows = await database.db
        .select()
        .from(images)
        .where(eq(images.chapterId, chapterId));
      expect(rows).toHaveLength(0);
      const [run] = await database.db
        .select({
          id: uploadValidationRuns.id,
          status: uploadValidationRuns.status,
        })
        .from(uploadValidationRuns)
        .where(eq(uploadValidationRuns.uploadId, upload.id))
        .orderBy(desc(uploadValidationRuns.attemptNumber))
        .limit(1);
      expect(run?.status).toBe("rejected");
      const issues = run
        ? await database.db
            .select({ code: uploadValidationIssues.code })
            .from(uploadValidationIssues)
            .where(eq(uploadValidationIssues.runId, run.id))
        : [];
      expect(issues.length).toBeGreaterThan(0);
      const operationList = await api.get("/me/upload-operations");
      expect((await operationList.json()).items).toContainEqual(
        expect.objectContaining({
          id: upload.id,
          kind: "chapter_upload",
          status: "rejected",
          issueCount: issues.length,
        }),
      );
      expect(
        await database.db
          .select()
          .from(chapterProcessingAttempts)
          .where(eq(chapterProcessingAttempts.chapterId, chapterId)),
      ).toHaveLength(0);
      expect(
        await database.db
          .select({ id: processingOutbox.id })
          .from(processingOutbox)
          .where(eq(processingOutbox.uploadId, upload.id)),
      ).toHaveLength(0);
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
      rmSync(`${process.cwd()}/.nodeprox-storage/Media/${slug}/1`, {
        recursive: true,
        force: true,
      });
      await database.sql.end();
      await api.dispose();
      await anonymous?.dispose();
    }
  });

  test("reloads hard limits per Admission job and projects non-blocking warnings", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    let api = await request.newContext({ baseURL: e2eApiOrigin });
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const reportRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/validation-report"))
        reportRequests.push(request.url());
    });
    const settingKeys = [
      "upload_warning_image_size_mb",
      "upload_max_image_size_mb",
      "upload_warning_height_px",
      "upload_max_height_px",
    ] as const;
    const previousSettings = await database.db
      .select()
      .from(systemConfig)
      .where(inArray(systemConfig.key, [...settingKeys]));
    const previousByKey = new Map(
      previousSettings.map((setting) => [setting.key, setting]),
    );
    const title = `M4-B E2E admission policy ${Date.now()}`;
    let slug = "";
    let seriesId = "";
    const chapterIds: string[] = [];
    try {
      const credentials = await createTestAdmin(database);
      api = await login(api, credentials);
      await authenticatePage(page, credentials);
      const saveSettings = async (
        warningMb: number,
        hardMb: number,
        warningHeight?: number,
        hardHeight?: number,
      ) => {
        const changes: Array<{ key: string; value: number }> = [
          { key: "upload_warning_image_size_mb", value: warningMb },
          { key: "upload_max_image_size_mb", value: hardMb },
        ];
        if (warningHeight !== undefined && hardHeight !== undefined) {
          changes.push(
            { key: "upload_warning_height_px", value: warningHeight },
            { key: "upload_max_height_px", value: hardHeight },
          );
        }
        const response = await api.patch("/admin/settings", {
          data: { changes },
          headers: { origin: e2eApiOrigin },
        });
        expect(response.status()).toBe(200);
      };
      await saveSettings(1, 64);
      const createdSeries = await api.post("/series", {
        data: { title },
        headers: { origin: e2eApiOrigin },
      });
      expect(createdSeries.status()).toBe(201);
      const createdSeriesBody = await createdSeries.json();
      seriesId = createdSeriesBody.id;
      slug = createdSeriesBody.slug;

      const createChapter = async (number: number) => {
        const response = await api.post(`/series/${seriesId}/chapters`, {
          data: { chapterNumber: number },
          headers: { origin: e2eApiOrigin },
        });
        expect(response.status()).toBe(201);
        const chapterId = (await response.json()).id as string;
        chapterIds.push(chapterId);
        return chapterId;
      };
      const oversizedJpeg = Buffer.concat([jpeg, Buffer.alloc(1_050_000)]);
      const warningChapterId = await createChapter(1);
      const warningZip = zipStored([{ name: "01.jpg", data: oversizedJpeg }]);
      const warningComplete = await directUpload(
        api,
        warningChapterId,
        "warning.zip",
        warningZip,
      );
      expect(warningComplete.status()).toBe(200);
      const warningUploadId = (await warningComplete.json()).uploadId as string;
      await pollUploadStatus(database.db, warningUploadId, "uploaded");
      await pollStatus(database.db, warningChapterId, "ready");
      const report = await api.get(
        `/me/upload-operations/chapter_upload/${warningUploadId}/validation-report`,
      );
      expect(report.status()).toBe(200);
      expect((await report.json()).warnings).toContainEqual({
        code: "large-file",
        filename: "01.jpg",
        sizeBytes: oversizedJpeg.length,
        thresholdBytes: 1024 * 1024,
      });
      const projected = await api.get("/me/upload-operations");
      expect((await projected.json()).items).toContainEqual(
        expect.objectContaining({ id: warningUploadId, warningCount: 1 }),
      );

      // This API-driven upload may complete before the browser observes an
      // active state. Reload to verify terminal history is not announced.
      await page.reload();
      await expect(
        page.getByRole("complementary", { name: "Navegación principal" }),
      ).toBeVisible();
      await expect(
        page.getByRole("dialog").filter({
          hasText: "Carga completada con advertencias",
        }),
      ).toHaveCount(0);
      expect(reportRequests).toHaveLength(0);
      await page
        .getByRole("button", { name: "Abrir centro de cargas" })
        .click();
      await page.getByRole("tab", { name: /Completadas/ }).click();
      await page.getByRole("button", { name: "Actualizar cargas" }).click();
      const warningRow = page
        .locator("article")
        .filter({ hasText: "warning.zip" });
      await expect(warningRow).toBeVisible();
      expect(reportRequests).toHaveLength(0);
      await warningRow.getByRole("button", { name: "Ver detalles" }).click();
      await expect.poll(() => reportRequests.length).toBe(1);
      await expect(
        page.getByRole("heading", { name: /Detalle de carga/ }),
      ).toBeVisible();
      await expect(page.getByText("01.jpg")).toBeVisible();
      await expect(page.getByText("Actual: 1 MB")).toBeVisible();
      await expect(page.getByText("Umbral recomendado: 1 MB")).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cerrar diálogo" })
        .click();
      await page.getByRole("button", { name: "Limpiar completadas" }).click();
      await expect(warningRow).toHaveCount(0);
      await page.getByRole("button", { name: "Actualizar cargas" }).click();
      await expect(warningRow).toHaveCount(0);
      await page.reload();
      await page
        .getByRole("button", { name: "Abrir centro de cargas" })
        .click();
      await page.getByRole("tab", { name: /Completadas/ }).click();
      await expect(
        page.locator("article").filter({ hasText: "warning.zip" }),
      ).toHaveCount(0);

      // This update occurs while the same Worker process is running.
      await saveSettings(1, 1);
      const rejectedChapterId = await createChapter(2);
      const rejectedZip = zipStored([{ name: "01.jpg", data: oversizedJpeg }]);
      const rejectedComplete = await directUpload(
        api,
        rejectedChapterId,
        "hard-limit.zip",
        rejectedZip,
      );
      expect(rejectedComplete.status()).toBe(200);
      const rejectedUploadId = (await rejectedComplete.json())
        .uploadId as string;
      await pollUploadStatus(database.db, rejectedUploadId, "rejected");
      const [rejectedChapter] = await database.db
        .select({ status: chapters.status })
        .from(chapters)
        .where(eq(chapters.id, rejectedChapterId));
      expect(rejectedChapter?.status).toBe("draft");
      const [run] = await database.db
        .select({
          id: uploadValidationRuns.id,
          status: uploadValidationRuns.status,
          requestId: uploadValidationRuns.requestId,
        })
        .from(uploadValidationRuns)
        .where(eq(uploadValidationRuns.uploadId, rejectedUploadId))
        .orderBy(desc(uploadValidationRuns.attemptNumber))
        .limit(1);
      expect(run?.status).toBe("rejected");
      const issues = run
        ? await database.db
            .select({ code: uploadValidationIssues.code })
            .from(uploadValidationIssues)
            .where(eq(uploadValidationIssues.runId, run.id))
        : [];
      expect(issues).toContainEqual({ code: "IMAGE_SIZE_EXCEEDED" });
      expect(
        await database.db
          .select()
          .from(processingOutbox)
          .where(eq(processingOutbox.uploadId, rejectedUploadId)),
      ).toHaveLength(0);
      const audit = await database.db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.resourceId, rejectedChapterId));
      expect(audit).toContainEqual(
        expect.objectContaining({
          action: "chapter.upload.admission.rejected",
          result: "rejected",
          reasonCode: "IMAGE_SIZE_EXCEEDED",
          requestId: run?.requestId,
        }),
      );
      const rejectedResult = page
        .getByRole("dialog")
        .filter({ hasText: "Carga rechazada" });
      await expect(rejectedResult).toBeVisible({ timeout: 30_000 });
      await rejectedResult.getByRole("button", { name: /Ver detalle/ }).click();
      await expect(page.getByText("Actual: 1 MB")).toBeVisible();
      await expect(page.getByText("Máximo: 1 MB")).toBeVisible();
      await expect(page.getByText("Código: IMAGE_SIZE_EXCEEDED")).toBeVisible();
      await expect(page.getByRole("tab", { name: /Errores 1/ })).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cerrar diálogo" })
        .click();
      await page
        .getByRole("button", { name: "Abrir centro de cargas" })
        .click();
      await page.getByRole("tab", { name: /Con errores/ }).click();
      const rejectedRow = page
        .locator("article")
        .filter({ hasText: "hard-limit.zip" });
      await expect(rejectedRow).toBeVisible();
      await rejectedRow.getByRole("button", { name: "Ver detalles" }).click();
      await expect(page.getByText("Actual: 1 MB")).toBeVisible();
      await expect(page.getByText("Máximo: 1 MB")).toBeVisible();
      await expect(page.getByText("Código: IMAGE_SIZE_EXCEEDED")).toBeVisible();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Cerrar diálogo" })
        .click();
      await page.getByRole("button", { name: "Limpiar errores" }).click();
      await expect(rejectedRow).toHaveCount(0);
      await page.getByRole("button", { name: "Actualizar cargas" }).click();
      await expect(rejectedRow).toHaveCount(0);
      await page.reload();
      await page
        .getByRole("button", { name: "Abrir centro de cargas" })
        .click();
      await page.getByRole("tab", { name: /Con errores/ }).click();
      await expect(
        page.locator("article").filter({ hasText: "hard-limit.zip" }),
      ).toHaveCount(0);

      await saveSettings(1, 64, 12000, 12000);
      const heightChapterId = await createChapter(3);
      const tallPng = Buffer.from(png);
      tallPng.writeUInt32BE(12001, 20);
      const heightZip = zipStored([{ name: "01.png", data: tallPng }]);
      const heightComplete = await directUpload(
        api,
        heightChapterId,
        "height-limit.zip",
        heightZip,
      );
      expect(heightComplete.status()).toBe(200);
      const heightUploadId = (await heightComplete.json()).uploadId as string;
      await pollUploadStatus(database.db, heightUploadId, "rejected");
      const heightReport = await api.get(
        `/me/upload-operations/chapter_upload/${heightUploadId}/validation-report`,
      );
      expect(heightReport.status()).toBe(200);
      expect((await heightReport.json()).issues).toContainEqual(
        expect.objectContaining({
          code: "IMAGE_HEIGHT_EXCEEDED",
          actual: { heightPx: 12001 },
          expected: { maxHeightPx: 12000 },
        }),
      );
    } finally {
      for (const chapterId of chapterIds) {
        await database.db.delete(images).where(eq(images.chapterId, chapterId));
        await database.db
          .delete(uploads)
          .where(eq(uploads.chapterId, chapterId));
        await database.db.delete(chapters).where(eq(chapters.id, chapterId));
      }
      if (seriesId)
        await database.db.delete(series).where(eq(series.id, seriesId));
      for (const key of settingKeys) {
        const previous = previousByKey.get(key);
        if (previous) {
          await database.db
            .update(systemConfig)
            .set({
              value: previous.value,
              updatedBy: previous.updatedBy,
              updatedAt: previous.updatedAt,
            })
            .where(eq(systemConfig.key, key));
        } else {
          await database.db
            .delete(systemConfig)
            .where(eq(systemConfig.key, key));
        }
      }
      if (slug)
        rmSync(`${process.cwd()}/.nodeprox-storage/Media/${slug}/1`, {
          recursive: true,
          force: true,
        });
      if (slug)
        rmSync(`${process.cwd()}/.nodeprox-storage/Media/${slug}/2`, {
          recursive: true,
          force: true,
        });
      await database.sql.end();
      await api.dispose();
    }
  });
});
