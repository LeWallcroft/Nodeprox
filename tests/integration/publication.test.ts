import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
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
  {
    database: database.db,
    secureCookie: false,
    publicMediaOrigin: "https://media.nodeprox.org",
  },
);
const userId = randomUUID();
const seriesId = randomUUID();
const readyChapterId = randomUUID();
const draftChapterId = randomUUID();
const emptyReadyChapterId = randomUUID();
const readyImageId = randomUUID();
const passwordHash = await new Argon2PasswordHasher().hash("publication-test");

beforeAll(async () => {
  await database.db.insert(users).values({
    id: userId,
    email: `publication-${userId}@example.com`,
    passwordHash,
    status: "active",
    role: "uploader",
  });
  await database.db.insert(series).values({
    id: seriesId,
    title: "Publication Series",
    slug: `publication-${seriesId}`,
    createdBy: userId,
  });
  await database.db.insert(chapters).values([
    {
      id: readyChapterId,
      seriesId,
      chapterNumber: 1,
      publicKey: "1",
      title: "Ready Chapter",
      status: "ready",
      createdBy: userId,
    },
    {
      id: draftChapterId,
      seriesId,
      chapterNumber: 2,
      publicKey: "2",
      title: "Draft Chapter",
      status: "draft",
      createdBy: userId,
    },
    {
      id: emptyReadyChapterId,
      seriesId,
      chapterNumber: 3,
      publicKey: "3",
      title: "Incomplete Chapter",
      status: "ready",
      createdBy: userId,
    },
  ]);
  await database.db.insert(images).values({
    id: readyImageId,
    chapterId: readyChapterId,
    filename: "01.jpg",
    storageKey: `Media/publication-${seriesId}/1/01.jpg`,
    extension: "jpg",
    contentType: "image/jpeg",
    sizeBytes: 128,
    sortOrder: 1,
    checksum: "a".repeat(64),
  });
});

afterAll(async () => {
  await database.db.delete(images).where(eq(images.id, readyImageId));
  await database.db
    .delete(chapters)
    .where(
      inArray(chapters.id, [
        readyChapterId,
        draftChapterId,
        emptyReadyChapterId,
      ]),
    );
  await database.db.delete(series).where(eq(series.id, seriesId));
  await database.db.delete(users).where(eq(users.id, userId));
  await app.close();
  await database.sql.end();
});

describe("M5-D public chapter publication", () => {
  it("publishes a ready chapter anonymously with public URLs only", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/public/chapters/${readyChapterId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      id: readyChapterId,
      seriesId,
      chapterNumber: 1,
      title: "Ready Chapter",
      images: [
        {
          id: readyImageId,
          filename: "01.jpg",
          extension: "jpg",
          contentType: "image/jpeg",
          sizeBytes: 128,
          sortOrder: 1,
          url: `https://media.nodeprox.org/publication-${seriesId}/1/01.jpg`,
        },
      ],
    });
    expect(response.json().images[0]).not.toHaveProperty("storageKey");
    expect(response.json().images[0]).not.toHaveProperty("checksum");
  });

  it("hides non-ready chapters and rejects invalid identifiers", async () => {
    for (const chapterId of [draftChapterId, emptyReadyChapterId]) {
      const response = await app.inject({
        method: "GET",
        url: `/public/chapters/${chapterId}`,
      });
      expect(response.statusCode).toBe(
        chapterId === draftChapterId ? 404 : 500,
      );
    }

    const invalid = await app.inject({
      method: "GET",
      url: "/public/chapters/not-a-uuid",
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().code).toBe("validation-failed");
  });
});
