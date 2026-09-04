import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { DrizzleChapterReplacementRepository } from "../../apps/api/src/modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  chapterReplacementItems,
  chapterReplacementOperations,
  images,
  imageVersions,
} from "../../database/schema/index.js";
import {
  createReadyReplacement,
  createReplacementChapter,
} from "./helpers/chapter-replacement-fixture.js";
import { insertImagesWithInitialVersions } from "./helpers/image-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);

afterAll(async () => database.sql.end());

describe("CHR2 database foundation", () => {
  it("CHR2-DB-01 persists every operation field", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    const repository = new DrizzleChapterReplacementRepository(database.db);
    const id = randomUUID();
    const created = await repository.create({
      id,
      chapterId: chapter.chapterId,
      requestedByUserId: chapter.userId,
      candidateZipStorageKey: `chapter-replacements/${id}.zip`,
      originalFilename: "chapter.zip",
      contentType: "application/zip",
      sizeBytes: 321,
      etag: "zip-etag",
    });
    expect(created).toMatchObject({
      id,
      chapterId: chapter.chapterId,
      requestedByUserId: chapter.userId,
      originalFilename: "chapter.zip",
      contentType: "application/zip",
      sizeBytes: 321,
      etag: "zip-etag",
      status: "pending_upload",
    });
  });

  it("CHR2-DB-02 rejects a second active operation for one Chapter", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    await createReadyReplacement(database.db, chapter, 1);
    await expect(
      createReadyReplacement(database.db, chapter, 1),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("CHR2-DB-03 permits a later operation after completion", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    const first = await createReadyReplacement(database.db, chapter, 1);
    await database.db
      .update(chapterReplacementOperations)
      .set({
        status: "completed",
        previousImageCount: 1,
        resultImageCount: 1,
        retainedImageCount: 1,
        createdImageCount: 0,
        retiredImageCount: 0,
        completedAt: new Date(),
      })
      .where(eq(chapterReplacementOperations.id, first.replacementId));
    await expect(
      createReadyReplacement(database.db, chapter, 1),
    ).resolves.toBeDefined();
  });

  it("CHR2-DB-04 enforces unique manifest order per operation", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    const replacement = await createReadyReplacement(database.db, chapter, 1);
    await expect(
      database.db.insert(chapterReplacementItems).values({
        id: randomUUID(),
        operationId: replacement.replacementId,
        sortOrder: 1,
        candidateStorageKey: `Media/${chapter.seriesSlug}/${chapter.chapterPublicKey}/${randomUUID()}.jpg`,
        physicalFilename: `${randomUUID()}.jpg`,
        originalFilename: "duplicate.jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
        checksum: "duplicate",
        storedAt: new Date(),
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("CHR2-DB-05 enforces globally unique candidate keys", async () => {
    const firstChapter = await createReplacementChapter(database.db, 1);
    const secondChapter = await createReplacementChapter(database.db, 1);
    const first = await createReadyReplacement(database.db, firstChapter, 1);
    const second = await createReadyReplacement(database.db, secondChapter, 0);
    const [item] = await database.db
      .select()
      .from(chapterReplacementItems)
      .where(eq(chapterReplacementItems.operationId, first.replacementId));
    if (!item) throw new Error("missing-fixture-item");
    await expect(
      database.db.insert(chapterReplacementItems).values({
        ...item,
        id: randomUUID(),
        operationId: second.replacementId,
        sortOrder: 2,
      }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("CHR2-DB-06 leaves existing Images active by default", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    const [image] = await database.db
      .select({
        retiredAt: images.retiredAt,
        retiredBy: images.retiredByChapterReplacementId,
      })
      .from(images)
      .where(eq(images.id, chapter.imageIds[0] as string));
    expect(image).toEqual({ retiredAt: null, retiredBy: null });
  });

  it("CHR2-DB-07 enforces one active Image per Chapter slot", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    await expect(
      insertImagesWithInitialVersions(database.db, [
        {
          chapterId: chapter.chapterId,
          filename: `${randomUUID()}.jpg`,
          storageKey: `Media/${chapter.seriesSlug}/${chapter.chapterPublicKey}/${randomUUID()}.jpg`,
          extension: "jpg",
          contentType: "image/jpeg",
          sizeBytes: 10,
          sortOrder: 1,
          checksum: "duplicate-slot",
        },
      ]),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("CHR2-DB-08 permits a retired and active Image in the same slot", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    const replacement = await createReadyReplacement(database.db, chapter, 1);
    await database.db
      .update(images)
      .set({
        retiredAt: new Date(),
        retiredByChapterReplacementId: replacement.replacementId,
      })
      .where(eq(images.id, chapter.imageIds[0] as string));
    await expect(
      insertImagesWithInitialVersions(database.db, [
        {
          chapterId: chapter.chapterId,
          filename: `${randomUUID()}.jpg`,
          storageKey: `Media/${chapter.seriesSlug}/${chapter.chapterPublicKey}/${randomUUID()}.jpg`,
          extension: "jpg",
          contentType: "image/jpeg",
          sizeBytes: 10,
          sortOrder: 1,
          checksum: "new-active-slot",
        },
      ]),
    ).resolves.toBeUndefined();
  });

  it("CHR2-DB-09 retirement preserves immutable version rows", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    const replacement = await createReadyReplacement(database.db, chapter, 1);
    const imageId = chapter.imageIds[0] as string;
    const before = await database.db
      .select()
      .from(imageVersions)
      .where(eq(imageVersions.imageId, imageId));
    await database.db
      .update(images)
      .set({
        retiredAt: new Date(),
        retiredByChapterReplacementId: replacement.replacementId,
      })
      .where(eq(images.id, imageId));
    expect(
      await database.db
        .select()
        .from(imageVersions)
        .where(eq(imageVersions.imageId, imageId)),
    ).toEqual(before);
  });

  it("CHR2-DB-10 persists exact result Image/version references", async () => {
    const chapter = await createReplacementChapter(database.db, 1);
    const replacement = await createReadyReplacement(database.db, chapter, 1);
    const [version] = await database.db
      .select({ id: imageVersions.id })
      .from(imageVersions)
      .where(eq(imageVersions.imageId, chapter.imageIds[0] as string));
    if (!version) throw new Error("missing-fixture-version");
    await database.db
      .update(chapterReplacementItems)
      .set({
        resultImageId: chapter.imageIds[0],
        resultImageVersionId: version.id,
      })
      .where(
        eq(chapterReplacementItems.operationId, replacement.replacementId),
      );
    const [item] = await database.db
      .select()
      .from(chapterReplacementItems)
      .where(
        eq(chapterReplacementItems.operationId, replacement.replacementId),
      );
    expect(item).toMatchObject({
      resultImageId: chapter.imageIds[0],
      resultImageVersionId: version.id,
    });
  });
});
