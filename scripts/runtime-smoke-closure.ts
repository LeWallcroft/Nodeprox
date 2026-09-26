import "dotenv/config";
import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { loadConfig, loadStorageConfig } from "@nodeprox/config";
import { B2Storage } from "@nodeprox/storage";
import { createDatabase } from "../database/client.js";
import { chapters, images, series, uploads } from "../database/schema/index.js";

const config = loadConfig();
const storageConfig = loadStorageConfig();
if (storageConfig.provider !== "b2")
  throw new Error("runtime-smoke-requires-b2");
const storage = new B2Storage(storageConfig.b2);
const database = createDatabase(config.DATABASE_URL);
const apiOrigin = `http://${config.API_HOST}:${config.API_PORT}`;
const adminEmail = process.env.ADMIN_BOOTSTRAP_EMAIL;
const adminPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
if (!adminEmail || !adminPassword)
  throw new Error("admin-bootstrap-config-missing");

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
    const checksum = crc32(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(checksum, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const localEntry = Buffer.concat([header, name, entry.data]);
    local.push(localEntry);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(checksum, 16);
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

async function api(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiOrigin}${path}`, init);
  return response;
}

async function waitFor(
  condition: () => Promise<boolean>,
  label: string,
  timeoutMs = 60_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`runtime-smoke-timeout:${label}`);
}

const login = await api("/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: adminEmail, password: adminPassword }),
});
if (login.status !== 204) throw new Error(`runtime-login-${login.status}`);
const setCookie = login.headers.get("set-cookie");
const cookie = setCookie?.split(";", 1)[0];
if (!cookie) throw new Error("runtime-session-cookie-missing");
const authenticated = (path: string, init: RequestInit = {}) =>
  api(path, {
    ...init,
    headers: { ...init.headers, cookie, origin: "http://localhost:3000" },
  });

const staleSeries = await database.db
  .select({ id: series.id })
  .from(series)
  .where(like(series.slug, "runtime-storage-%"));
for (const stale of staleSeries) {
  const staleChapters = await database.db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.seriesId, stale.id));
  for (const chapter of staleChapters) {
    const response = await authenticated(`/chapters/${chapter.id}`, {
      method: "DELETE",
    });
    if (response.status !== 204 && response.status !== 404)
      throw new Error(`stale-runtime-delete-${response.status}`);
  }
  await waitFor(async () => {
    const remaining = await database.db
      .select({ id: chapters.id })
      .from(chapters)
      .where(eq(chapters.seriesId, stale.id));
    return remaining.length === 0;
  }, "stale-runtime-cleanup");
  const removed = await authenticated(`/series/${stale.id}`, {
    method: "DELETE",
  });
  if (removed.status !== 204 && removed.status !== 404)
    throw new Error(`stale-runtime-series-${removed.status}`);
}

const slug = `runtime-storage-${Date.now()}-${randomUUID().slice(0, 8)}`;
const createdSeries = await authenticated("/series", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ title: "Runtime storage closure", slug }),
});
if (createdSeries.status !== 201)
  throw new Error(`runtime-series-${createdSeries.status}`);
const seriesId = ((await createdSeries.json()) as { id: string }).id;

const jpeg = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EB//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EB//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EB//2Q==",
  "base64",
);
const cases = [
  {
    chapterNumber: 6,
    filename: "6.zip",
    entries: [
      { name: "6/01.jpg", data: jpeg },
      { name: "6/02.jpg", data: jpeg },
    ],
  },
];
const results: Array<Record<string, unknown>> = [];

for (const item of cases) {
  const chapterResponse = await authenticated(`/series/${seriesId}/chapters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chapterNumber: item.chapterNumber }),
  });
  if (chapterResponse.status !== 201)
    throw new Error(`runtime-chapter-${chapterResponse.status}`);
  const chapterId = ((await chapterResponse.json()) as { id: string }).id;
  const zip = zipStored(item.entries);
  const initiate = await authenticated(
    `/chapters/${chapterId}/uploads/initiate`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: item.filename,
        contentType: "application/zip",
        sizeBytes: zip.length,
      }),
    },
  );
  if (initiate.status !== 201)
    throw new Error(`runtime-initiate-${initiate.status}`);
  const grant = (await initiate.json()) as {
    uploadId: string;
    transfer: { url: string; headers: Record<string, string> };
  };
  const put = await fetch(grant.transfer.url, {
    method: "PUT",
    headers: grant.transfer.headers,
    body: zip,
  });
  if (!put.ok) throw new Error(`runtime-b2-put-${put.status}`);
  const complete = await authenticated(
    `/chapters/${chapterId}/uploads/${grant.uploadId}/complete`,
    { method: "POST" },
  );
  if (!complete.ok) throw new Error(`runtime-complete-${complete.status}`);
  await waitFor(async () => {
    const [row] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    if (row?.status === "failed") throw new Error("runtime-processing-failed");
    return row?.status === "ready";
  }, `chapter-${item.chapterNumber}-ready`);
  const [upload] = await database.db
    .select({ storageKey: uploads.storageKey })
    .from(uploads)
    .where(eq(uploads.id, grant.uploadId));
  const storedImages = await database.db
    .select()
    .from(images)
    .where(eq(images.chapterId, chapterId));
  if (!upload || storedImages.length !== item.entries.length)
    throw new Error("runtime-persistence-missing");
  const publicChapter = await api(`/public/chapters/${chapterId}`);
  const publicPayload = (await publicChapter.json()) as {
    images: Array<{ url: string }>;
  };
  const canonicalUrls = publicPayload.images.map((entry) => entry.url);
  if (canonicalUrls.length !== item.entries.length)
    throw new Error("runtime-public-url-missing");
  const canonicalResponses = await Promise.all(
    canonicalUrls.map((url) =>
      fetch(url, { redirect: "follow" }).catch(() => null),
    ),
  );
  results.push({
    chapterId,
    chapterNumber: item.chapterNumber,
    filenames: storedImages.map((image) => image.filename),
    contentTypes: storedImages.map((image) => image.contentType),
    imageSizes: storedImages.map((image) => image.sizeBytes),
    imageExists: await Promise.all(
      storedImages.map((image) => storage.exists(image.storageKey)),
    ),
    legacyUuidImageExists: await Promise.all(
      storedImages.map((image) =>
        storage.exists(`Media/${seriesId}/${chapterId}/${image.filename}`),
      ),
    ),
    sourceExists: await storage.exists(upload.storageKey),
    imageStorageKeys: storedImages.map((image) => image.storageKey),
    sourceStorageKey: upload.storageKey,
    canonicalUrls,
    canonicalHttp: canonicalResponses.map(
      (response) => response?.status ?? "unreachable",
    ),
    canonicalContentTypes: canonicalResponses.map(
      (response) => response?.headers.get("content-type") ?? null,
    ),
  });
}

const deleted = results[0];
if (!deleted || typeof deleted.chapterId !== "string")
  throw new Error("runtime-delete-target-missing");
const deleteResponse = await authenticated(`/chapters/${deleted.chapterId}`, {
  method: "DELETE",
});
if (deleteResponse.status !== 204)
  throw new Error(`runtime-delete-${deleteResponse.status}`);
await waitFor(async () => {
  const [row] = await database.db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.id, deleted.chapterId as string));
  return !row;
}, "chapter-delete-finalized");
const deletedImageKeys = deleted.imageStorageKeys;
const deletedSourceKey = deleted.sourceStorageKey;
if (!Array.isArray(deletedImageKeys) || typeof deletedSourceKey !== "string")
  throw new Error("runtime-delete-keys-missing");
const deletionResult = {
  chapterId: deleted.chapterId,
  finalized: true,
  imageExists: await Promise.all(
    deletedImageKeys.map((key) => storage.exists(String(key))),
  ),
  sourceExists: await storage.exists(deletedSourceKey),
  publicHttp: await fetch(deleted.canonicalUrl as string)
    .then((response) => response.status)
    .catch(() => "unreachable"),
};

for (const remaining of results.slice(1)) {
  const response = await authenticated(`/chapters/${remaining.chapterId}`, {
    method: "DELETE",
  });
  if (response.status !== 204)
    throw new Error(`runtime-cleanup-${response.status}`);
}
await waitFor(async () => {
  const remaining = await database.db
    .select({ id: chapters.id })
    .from(chapters)
    .where(eq(chapters.seriesId, seriesId));
  return remaining.length === 0;
}, "runtime-cleanup-finalized");
const removedSeries = await authenticated(`/series/${seriesId}`, {
  method: "DELETE",
});
if (removedSeries.status !== 204)
  throw new Error(`runtime-series-cleanup-${removedSeries.status}`);

console.log(
  JSON.stringify({
    services: {
      postgres: "UP",
      redis: "UP",
      api: "UP",
      web: "UP",
      worker: "UP",
    },
    cases: results,
    deletion: deletionResult,
  }),
);
await database.sql.end();
