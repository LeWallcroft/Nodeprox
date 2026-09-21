import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { DrizzleSeriesRepository } from "../../apps/api/src/modules/series/infrastructure/persistence/drizzle/series.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  chapterReplacementOperations,
  chapters,
  images,
  series,
  seriesAssignments,
  users,
} from "../../database/schema/index.js";
import { insertImagesWithInitialVersions } from "./helpers/image-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const password = "series-read-model-counts-password";
const gestorId = randomUUID();
const uploaderId = randomUUID();
const emptySeriesId = randomUUID();
const countedSeriesId = randomUUID();
const otherSeriesId = randomUUID();
const chapterIds = [randomUUID(), randomUUID(), randomUUID()];
const deletingChapterId = randomUUID();
const otherChapterId = randomUUID();
const retiredImageId = randomUUID();
const retirementOperationId = randomUUID();
const hasher = new Argon2PasswordHasher();
const gestorEmail = `series-counts-gestor-${gestorId}@example.com`;
const uploaderEmail = `series-counts-uploader-${uploaderId}@example.com`;

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
      id: gestorId,
      email: gestorEmail,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: uploaderId,
      email: uploaderEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
  await database.db.insert(series).values([
    {
      id: emptySeriesId,
      title: "Series Counts Empty",
      slug: `series-counts-empty-${emptySeriesId}`,
      createdBy: gestorId,
    },
    {
      id: countedSeriesId,
      title: "Series Counts Distributed",
      slug: `series-counts-distributed-${countedSeriesId}`,
      createdBy: gestorId,
    },
    {
      id: otherSeriesId,
      title: "Series Counts Other",
      slug: `series-counts-other-${otherSeriesId}`,
      createdBy: gestorId,
    },
  ]);
  await database.db.insert(seriesAssignments).values([
    {
      seriesId: emptySeriesId,
      responsibleUserId: gestorId,
      assignedBy: gestorId,
    },
    {
      seriesId: countedSeriesId,
      responsibleUserId: gestorId,
      assignedBy: gestorId,
    },
    {
      seriesId: otherSeriesId,
      responsibleUserId: uploaderId,
      assignedBy: gestorId,
    },
  ]);
  await database.db.insert(chapters).values([
    {
      id: chapterIds[0],
      seriesId: countedSeriesId,
      chapterNumber: 1,
      publicKey: "1",
      createdBy: gestorId,
      status: "ready",
    },
    {
      id: chapterIds[1],
      seriesId: countedSeriesId,
      chapterNumber: 2,
      publicKey: "2",
      createdBy: gestorId,
      status: "ready",
    },
    {
      id: chapterIds[2],
      seriesId: countedSeriesId,
      chapterNumber: 3,
      publicKey: "3",
      createdBy: gestorId,
      status: "draft",
    },
    {
      id: otherChapterId,
      seriesId: otherSeriesId,
      chapterNumber: 1,
      publicKey: "1",
      createdBy: gestorId,
      status: "ready",
    },
    {
      id: deletingChapterId,
      seriesId: countedSeriesId,
      chapterNumber: 4,
      publicKey: "4",
      createdBy: gestorId,
      status: "deleting",
    },
  ]);
  await insertImagesWithInitialVersions(database.db, [
    ...Array.from({ length: 5 }, (_, index) => ({
      chapterId: chapterIds[0] as string,
      filename: `one-${index}.jpg`,
      storageKey: `series-counts/${countedSeriesId}/1/${index}.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 1,
      sortOrder: index,
      checksum: `one-${index}`,
    })),
    ...Array.from({ length: 8 }, (_, index) => ({
      chapterId: chapterIds[1] as string,
      filename: `two-${index}.jpg`,
      storageKey: `series-counts/${countedSeriesId}/2/${index}.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 1,
      sortOrder: index,
      checksum: `two-${index}`,
    })),
    {
      chapterId: otherChapterId,
      filename: "other.jpg",
      storageKey: `series-counts/${otherSeriesId}/1/other.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 1,
      sortOrder: 0,
      checksum: "other",
    },
    {
      id: retiredImageId,
      chapterId: chapterIds[2] as string,
      filename: "retired.jpg",
      storageKey: `series-counts/${countedSeriesId}/3/retired.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 1,
      sortOrder: 20,
      checksum: "retired",
    },
    ...Array.from({ length: 2 }, (_, index) => ({
      chapterId: deletingChapterId,
      filename: `deleting-${index}.jpg`,
      storageKey: `series-counts/${countedSeriesId}/4/${index}.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 1,
      sortOrder: index,
      checksum: `deleting-${index}`,
    })),
  ]);
  await database.db.insert(chapterReplacementOperations).values({
    id: retirementOperationId,
    chapterId: chapterIds[2] as string,
    requestedByUserId: gestorId,
    candidateZipStorageKey: `series-counts/${retirementOperationId}.zip`,
    originalFilename: "retirement-fixture.zip",
    contentType: "application/zip",
    sizeBytes: 1,
    status: "failed",
  });
  await database.db
    .update(images)
    .set({
      retiredAt: new Date(),
      retiredByChapterReplacementId: retirementOperationId,
    })
    .where(eq(images.id, retiredImageId));
});

afterAll(async () => {
  await database.db
    .delete(images)
    .where(
      inArray(images.chapterId, [
        ...chapterIds,
        deletingChapterId,
        otherChapterId,
      ]),
    );
  await database.db
    .delete(chapterReplacementOperations)
    .where(eq(chapterReplacementOperations.id, retirementOperationId));
  await database.db
    .delete(chapters)
    .where(
      inArray(chapters.id, [...chapterIds, deletingChapterId, otherChapterId]),
    );
  await database.db
    .delete(seriesAssignments)
    .where(
      inArray(seriesAssignments.seriesId, [
        emptySeriesId,
        countedSeriesId,
        otherSeriesId,
      ]),
    );
  await database.db
    .delete(series)
    .where(inArray(series.id, [emptySeriesId, countedSeriesId, otherSeriesId]));
  await database.db
    .delete(users)
    .where(inArray(users.id, [gestorId, uploaderId]));
  await app.close();
  await database.sql.end();
});

describe("Series list read-model counts", () => {
  it("projects aggregate counts in the repository without N+1 reads", async () => {
    const repository = new DrizzleSeriesRepository(database.db);

    const items = await repository.listAll();

    expect(items.find((item) => item.id === countedSeriesId)).toEqual(
      expect.objectContaining({ chapterCount: 3, imageCount: 13 }),
    );
    expect(items.find((item) => item.id === emptySeriesId)).toEqual(
      expect.objectContaining({ chapterCount: 0, imageCount: 0 }),
    );
  });

  it("returns zeroes for empty Series and isolated aggregate counts per Series", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/series",
      headers: { cookie: await login(gestorEmail) },
    });

    expect(response.statusCode).toBe(200);
    const items = response.json() as Array<{
      id: string;
      chapterCount: number;
      imageCount: number;
    }>;
    expect(items.filter((item) => item.id === countedSeriesId)).toEqual([
      expect.objectContaining({ chapterCount: 3, imageCount: 13 }),
    ]);
    expect(items.filter((item) => item.id === emptySeriesId)).toEqual([
      expect.objectContaining({ chapterCount: 0, imageCount: 0 }),
    ]);
    expect(items.filter((item) => item.id === otherSeriesId)).toEqual([
      expect.objectContaining({ chapterCount: 1, imageCount: 1 }),
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });

  it("preserves the existing visibility scope while returning counts", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/series",
      headers: { cookie: await login(uploaderEmail) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([
      expect.objectContaining({
        id: otherSeriesId,
        chapterCount: 1,
        imageCount: 1,
      }),
    ]);
  });

  it("projects authoritative image counts for the scoped Series Chapters list", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/series/${countedSeriesId}/chapters`,
      headers: { cookie: await login(gestorEmail) },
    });

    expect(response.statusCode).toBe(200);
    const items = response.json() as Array<{ id: string; imageCount: number }>;
    expect(items.find((item) => item.id === chapterIds[0])).toEqual(
      expect.objectContaining({ imageCount: 5 }),
    );
    expect(items.find((item) => item.id === chapterIds[1])).toEqual(
      expect.objectContaining({ imageCount: 8 }),
    );
    expect(items.find((item) => item.id === chapterIds[2])).toEqual(
      expect.objectContaining({ imageCount: 0 }),
    );
    expect(items.find((item) => item.id === deletingChapterId)).toBeUndefined();
  });
});
