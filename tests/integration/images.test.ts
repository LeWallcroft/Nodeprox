import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { FilesystemStorage } from "../../packages/storage/src/adapters.js";
import { loadConfig } from "../../packages/config/src/index.js";
import { PublicMediaUrl } from "../../apps/api/src/modules/images/domain/public-media-url.js";
import { createDatabase } from "../../database/client.js";
import {
  chapters,
  images,
  series,
  users,
} from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const ownerId = randomUUID();
const otherId = randomUUID();
const seriesId = randomUUID();
const chapterId = randomUUID();
const imageId = randomUUID();
const password = "m5-images-password";
const ownerEmail = `m5-images-owner-${ownerId}@example.com`;
const otherEmail = `m5-images-other-${otherId}@example.com`;
const storage = new FilesystemStorage(`${process.cwd()}/.nodeprox-storage`);
const storageKey = `Media/${seriesId}/${chapterId}/01.jpg`;
const content = Buffer.from("image-content");
const hasher = new Argon2PasswordHasher();

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  return cookieValue(response.headers["set-cookie"]);
}

beforeAll(async () => {
  const passwordHash = await hasher.hash(password);
  await database.db.insert(users).values([
    {
      id: ownerId,
      email: ownerEmail,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: otherId,
      email: otherEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
  await database.db.insert(series).values({
    id: seriesId,
    title: "M5 Images Series",
    slug: `m5-images-${seriesId}`,
    createdBy: ownerId,
  });
  await database.db.insert(chapters).values({
    id: chapterId,
    seriesId,
    chapterNumber: 1,
    createdBy: ownerId,
    status: "ready",
  });
  await database.db.insert(images).values({
    id: imageId,
    chapterId,
    filename: "01.jpg",
    storageKey,
    extension: "jpg",
    contentType: "image/jpeg",
    sizeBytes: content.length,
    sortOrder: 1,
    checksum: "sha256-test",
  });
  await storage.put({
    key: storageKey,
    body: Readable.from([content]),
    contentType: "image/jpeg",
    sizeBytes: content.length,
  });
});

afterAll(async () => {
  await storage.delete(storageKey);
  await database.db.delete(images).where(eq(images.id, imageId));
  await database.db.delete(chapters).where(eq(chapters.id, chapterId));
  await database.db.delete(series).where(eq(series.id, seriesId));
  await database.db.delete(users).where(inArray(users.id, [ownerId, otherId]));
  await app.close();
  await database.sql.end();
});

describe("M5-B Images HTTP contract", () => {
  it("lists metadata in sort order and omits storageKey", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/chapters/${chapterId}/images`,
      headers: { cookie: await login(ownerEmail) },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      images: [
        expect.objectContaining({
          id: imageId,
          chapterId,
          filename: "01.jpg",
          sortOrder: 1,
          sizeBytes: content.length,
        }),
      ],
    });
    expect(response.json().images[0]).not.toHaveProperty("storageKey");

    const config = loadConfig({
      DATABASE_URL: infrastructure.databaseUrl,
      REDIS_URL: infrastructure.redisUrl,
    });
    const publicUrl = PublicMediaUrl.fromImage(config.PUBLIC_MEDIA_ORIGIN, {
      id: imageId,
      seriesId,
      chapterId,
      extension: "jpg",
      contentType: "image/jpeg",
    });
    expect(publicUrl.toString()).toBe(
      `https://media.nodeprox.org/series/${seriesId}/chapters/${chapterId}/images/${imageId}.jpg`,
    );
  });

  it("returns metadata and streams content with persisted headers", async () => {
    const cookie = await login(ownerEmail);
    const metadata = await app.inject({
      method: "GET",
      url: `/images/${imageId}`,
      headers: { cookie },
    });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json()).not.toHaveProperty("storageKey");

    const response = await app.inject({
      method: "GET",
      url: `/images/${imageId}/content`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers["content-length"]).toBe(String(content.length));
    expect(Buffer.from(response.rawPayload)).toEqual(content);
  });

  it("denies cross-user access and missing images safely", async () => {
    const otherCookie = await login(otherEmail);
    const denied = await app.inject({
      method: "GET",
      url: `/images/${imageId}`,
      headers: { cookie: otherCookie },
    });
    expect(denied.statusCode).toBe(403);

    const missing = await app.inject({
      method: "GET",
      url: `/images/${randomUUID()}`,
      headers: { cookie: await login(ownerEmail) },
    });
    expect(missing.statusCode).toBe(404);
  });
});
