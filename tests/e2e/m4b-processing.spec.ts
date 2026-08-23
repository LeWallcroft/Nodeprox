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
import { and, eq } from "drizzle-orm";
import { createDatabase } from "../../database/client.js";
import {
  chapters,
  images,
  series,
  uploads,
} from "../../database/schema/index.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { AdminBootstrapService } from "../../apps/api/src/modules/authorization/application/services/admin-bootstrap.service.js";
import { DrizzleAdminBootstrapStore } from "../../apps/api/src/modules/authorization/infrastructure/bootstrap/drizzle-admin-bootstrap.store.js";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const gif = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

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
  { name: "03.webp", data: webp },
  { name: "01.jpg", data: jpeg },
  { name: "04.gif", data: gif },
  { name: "02.png", data: png },
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
    if (chapter?.status === "ready" || chapter?.status === "failed")
      throw new Error(`unexpected final chapter status: ${chapter.status}`);
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
    headers: { origin: "http://127.0.0.1:3001" },
  });
  expect(response.status()).toBe(204);
  const setCookie = response.headers()["set-cookie"];
  const token = /^nodeprox_session=([^;]+)/.exec(setCookie ?? "")?.[1];
  if (!token) throw new Error("authentication session cookie was not issued");
  const authenticated = await request.newContext({
    baseURL: "http://127.0.0.1:3001",
    extraHTTPHeaders: { cookie: `nodeprox_session=${token}` },
  });
  await api.dispose();
  const session = await authenticated.get("/auth/session");
  expect(session.status()).toBe(200);
  return authenticated;
}

test.describe("M4-B real upload processing", () => {
  test("processes a valid ZIP through API, outbox, BullMQ and Worker", async () => {
    let api = await request.newContext({ baseURL: "http://127.0.0.1:3001" });
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const slug = `e2e-valid-${Date.now()}`;
    let seriesId = "";
    let chapterId = "";
    try {
      api = await login(api, await createTestAdmin(database));
      const createdSeries = await api.post("/series", {
        data: { title: "M4-B E2E valid", slug },
        headers: { origin: "http://127.0.0.1:3001" },
      });
      expect(createdSeries.status()).toBe(201);
      seriesId = (await createdSeries.json()).id;
      const createdChapter = await api.post(`/series/${seriesId}/chapters`, {
        data: { chapterNumber: 1, title: "Valid ZIP" },
        headers: { origin: "http://127.0.0.1:3001" },
      });
      expect(createdChapter.status()).toBe(201);
      chapterId = (await createdChapter.json()).id;

      const uploaded = await api.post(`/chapters/${chapterId}/upload`, {
        multipart: {
          file: {
            name: "chapter.zip",
            mimeType: "application/zip",
            buffer: validZip,
          },
        },
        headers: { origin: "http://127.0.0.1:3001" },
      });
      if (uploaded.status() !== 201)
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
            row.storageKey === `Media/${seriesId}/${chapterId}/${row.filename}`,
        ),
      ).toBe(true);
      expect(
        rows.every((row) => row.sizeBytes > 0 && row.checksum.length === 64),
      ).toBe(true);
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
    }
  });

  test("marks an invalid ZIP failed and cleans partial processing state", async () => {
    let api = await request.newContext({ baseURL: "http://127.0.0.1:3001" });
    const database = createDatabase(loadDatabaseConfig().DATABASE_URL);
    const slug = `e2e-invalid-${Date.now()}`;
    let seriesId = "";
    let chapterId = "";
    try {
      api = await login(api, await createTestAdmin(database));
      const createdSeries = await api.post("/series", {
        data: { title: "M4-B E2E invalid", slug },
        headers: { origin: "http://127.0.0.1:3001" },
      });
      seriesId = (await createdSeries.json()).id;
      const createdChapter = await api.post(`/series/${seriesId}/chapters`, {
        data: { chapterNumber: 1 },
        headers: { origin: "http://127.0.0.1:3001" },
      });
      chapterId = (await createdChapter.json()).id;
      const uploaded = await api.post(`/chapters/${chapterId}/upload`, {
        multipart: {
          file: {
            name: "invalid.zip",
            mimeType: "application/zip",
            buffer: Buffer.from([
              0x50, 0x4b, 0x03, 0x04, 0x69, 0x6e, 0x76, 0x61, 0x6c, 0x69, 0x64,
            ]),
          },
        },
        headers: { origin: "http://127.0.0.1:3001" },
      });
      if (uploaded.status() !== 201)
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
        `${process.cwd()}/.nodeprox-storage/Media/${seriesId}/${chapterId}`,
        { recursive: true, force: true },
      );
      await database.sql.end();
      await api.dispose();
    }
  });
});
