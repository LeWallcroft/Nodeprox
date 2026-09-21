import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { DrizzleChapterMediaReplacementRepository } from "../../apps/api/src/modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-media-replacement.repository.js";
import { DrizzleImageRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/image.repository.js";
import { DrizzleImageVersionResultRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/image-version-result.repository.js";
import { GetPublishedChapter } from "../../apps/api/src/modules/publication/application/services/get-published-chapter.js";
import { DrizzlePublishedChapterRepository } from "../../apps/api/src/modules/publication/infrastructure/persistence/drizzle/published-chapter.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterReplacementItems,
  chapterReplacementOperations,
  images,
  imageVersions,
  mediaEffectOutbox,
} from "../../database/schema/index.js";
import {
  createReadyReplacement,
  createReplacementChapter,
} from "./helpers/chapter-replacement-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const publicOrigin = "https://media.nodeprox.org";

afterAll(async () => database.sql.end());

async function fixture(oldCount: number, newCount: number) {
  const chapter = await createReplacementChapter(database.db, oldCount);
  const replacement = await createReadyReplacement(
    database.db,
    chapter,
    newCount,
  );
  const repository = new DrizzleChapterMediaReplacementRepository(
    database.db,
    publicOrigin,
  );
  return { chapter, replacement, repository };
}

async function activate(target: Awaited<ReturnType<typeof fixture>>) {
  const outcome = await target.repository.activate({
    replacementId: target.replacement.replacementId,
    chapterId: target.chapter.chapterId,
    actorUserId: target.chapter.userId,
  });
  if (outcome.outcome !== "completed")
    throw new Error(`activation-${outcome.outcome}`);
  return outcome.result;
}

async function versionsFor(imageIds: readonly string[]) {
  if (imageIds.length === 0) return [];
  return database.db
    .select()
    .from(imageVersions)
    .where(inArray(imageVersions.imageId, [...imageIds]));
}

describe("CHR2 atomic whole-Chapter activation", () => {
  it("CHR2-ACT-01 preserves overlapping logical Image IDs", async () => {
    const target = await fixture(3, 3);
    await activate(target);
    const active = await new DrizzleImageRepository(
      database.db,
    ).listByChapterId(target.chapter.chapterId);
    expect(active.map((image) => image.id)).toEqual(target.chapter.imageIds);
  });

  it("CHR2-ACT-02 creates one new version for every retained Image", async () => {
    const target = await fixture(3, 3);
    await activate(target);
    expect(await versionsFor(target.chapter.imageIds)).toHaveLength(6);
  });

  it("CHR2-ACT-03 points current_version_id at exact manifest results", async () => {
    const target = await fixture(2, 2);
    await activate(target);
    const mappings = await database.db
      .select({
        imageId: chapterReplacementItems.resultImageId,
        versionId: chapterReplacementItems.resultImageVersionId,
      })
      .from(chapterReplacementItems)
      .where(
        eq(
          chapterReplacementItems.operationId,
          target.replacement.replacementId,
        ),
      );
    for (const mapping of mappings) {
      const [image] = await database.db
        .select({ currentVersionId: images.currentVersionId })
        .from(images)
        .where(eq(images.id, mapping.imageId as string));
      expect(image?.currentVersionId).toBe(mapping.versionId);
    }
  });

  it("CHR2-ACT-04 leaves historical versions unchanged", async () => {
    const target = await fixture(2, 2);
    const before = await versionsFor(target.chapter.imageIds);
    await activate(target);
    const after = await versionsFor(target.chapter.imageIds);
    expect(after.filter((version) => version.version === 1)).toEqual(before);
  });

  it("CHR2-ACT-05 creates only required additional logical Images", async () => {
    const target = await fixture(2, 5);
    await activate(target);
    const active = await new DrizzleImageRepository(
      database.db,
    ).listByChapterId(target.chapter.chapterId);
    expect(active).toHaveLength(5);
    expect(
      active.filter((image) => !target.chapter.imageIds.includes(image.id)),
    ).toHaveLength(3);
  });

  it("CHR2-ACT-06 starts new logical Images at version 1", async () => {
    const target = await fixture(1, 3);
    await activate(target);
    const items = await database.db
      .select({ imageId: chapterReplacementItems.resultImageId })
      .from(chapterReplacementItems)
      .where(
        eq(
          chapterReplacementItems.operationId,
          target.replacement.replacementId,
        ),
      );
    const addedIds = items
      .map((item) => item.imageId)
      .filter(
        (id): id is string =>
          Boolean(id) && !target.chapter.imageIds.includes(id as string),
      );
    const addedVersions = await versionsFor(addedIds);
    expect(addedVersions.map((version) => version.version)).toEqual([1, 1]);
  });

  it("CHR2-ACT-07 retires excess Images without deleting them", async () => {
    const target = await fixture(4, 2);
    await activate(target);
    const retired = await database.db
      .select()
      .from(images)
      .where(
        and(
          eq(images.chapterId, target.chapter.chapterId),
          isNotNull(images.retiredAt),
        ),
      );
    expect(retired.map((image) => image.id)).toEqual(
      target.chapter.imageIds.slice(2),
    );
    expect(
      retired.every(
        (image) =>
          image.retiredByChapterReplacementId ===
          target.replacement.replacementId,
      ),
    ).toBe(true);
  });

  it("CHR2-ACT-08 excludes retired Images from canonical repository", async () => {
    const target = await fixture(4, 2);
    await activate(target);
    expect(
      await new DrizzleImageRepository(database.db).listByChapterId(
        target.chapter.chapterId,
      ),
    ).toHaveLength(2);
  });

  it("CHR2-ACT-09 keeps retired Image versions historically queryable", async () => {
    const target = await fixture(3, 1);
    const retiredId = target.chapter.imageIds[2] as string;
    const [historical] = await database.db
      .select({ id: imageVersions.id })
      .from(imageVersions)
      .where(eq(imageVersions.imageId, retiredId));
    await activate(target);
    const result = await new DrizzleImageVersionResultRepository(
      database.db,
      publicOrigin,
    ).findVersionResultById(historical?.id as string);
    expect(result?.imageId).toBe(retiredId);
  });

  it("CHR2-ACT-10 uses slot order rather than filenames for identity", async () => {
    const target = await fixture(2, 2);
    await activate(target);
    const active = await new DrizzleImageRepository(
      database.db,
    ).listByChapterId(target.chapter.chapterId);
    expect(active.map((image) => image.id)).toEqual(target.chapter.imageIds);
    expect(active.map((image) => image.filename)).toEqual(
      target.chapter.imageIds.map((id) => `old-${id}_v2.jpg`),
    );
  });

  it("CHR2-ACT-11 computes result counts server-side", async () => {
    const target = await fixture(4, 6);
    await expect(activate(target)).resolves.toMatchObject({
      previousImageCount: 4,
      imageCount: 6,
      retainedImageCount: 4,
      createdImageCount: 2,
      retiredImageCount: 0,
    });
  });

  it("CHR2-ACT-12 persists exact manifest result mappings", async () => {
    const target = await fixture(2, 4);
    await activate(target);
    const items = await database.db
      .select()
      .from(chapterReplacementItems)
      .where(
        eq(
          chapterReplacementItems.operationId,
          target.replacement.replacementId,
        ),
      );
    expect(items).toHaveLength(4);
    expect(
      items.every((item) => item.resultImageId && item.resultImageVersionId),
    ).toBe(true);
  });

  it("CHR2-ACT-13 completes operation atomically with cutover", async () => {
    const target = await fixture(2, 2);
    const result = await activate(target);
    const [operation] = await database.db
      .select()
      .from(chapterReplacementOperations)
      .where(
        eq(chapterReplacementOperations.id, target.replacement.replacementId),
      );
    expect(operation).toMatchObject({
      status: "completed",
      resultImageCount: result.imageCount,
      completedAt: result.completedAt,
    });
  });

  it("CHR2-ACT-14 rolls back every mutation on late transaction failure", async () => {
    const target = await fixture(2, 2);
    const [oldImage] = await database.db
      .select()
      .from(images)
      .where(eq(images.id, target.chapter.imageIds[0] as string));
    if (!oldImage) throw new Error("missing-old-image");
    const oldUrl = `${publicOrigin}/${target.chapter.seriesSlug}/${target.chapter.chapterPublicKey}/${oldImage.filename}`;
    await database.db.insert(mediaEffectOutbox).values({
      replacementOperationId: target.replacement.replacementId,
      effectType: "cdn_purge",
      imageId: oldImage.id,
      target: oldUrl,
    });
    const beforeVersions = await versionsFor(target.chapter.imageIds);
    await expect(activate(target)).rejects.toMatchObject({
      cause: { code: "23505" },
    });
    expect(await versionsFor(target.chapter.imageIds)).toEqual(beforeVersions);
    const [operation] = await database.db
      .select()
      .from(chapterReplacementOperations)
      .where(
        eq(chapterReplacementOperations.id, target.replacement.replacementId),
      );
    expect(operation?.status).toBe("ready");
    expect(
      await database.db
        .select()
        .from(chapterReplacementItems)
        .where(
          and(
            eq(
              chapterReplacementItems.operationId,
              target.replacement.replacementId,
            ),
            isNotNull(chapterReplacementItems.resultImageId),
          ),
        ),
    ).toHaveLength(0);
  });

  it("CHR2-ACT-15 returns the exact persisted result on retry", async () => {
    const target = await fixture(2, 3);
    const first = await activate(target);
    const second = await activate(target);
    expect(second).toEqual(first);
  });

  it("CHR2-ACT-16 creates zero extra versions on completed retry", async () => {
    const target = await fixture(2, 2);
    await activate(target);
    const before = await versionsFor(target.chapter.imageIds);
    await activate(target);
    expect(await versionsFor(target.chapter.imageIds)).toEqual(before);
  });

  it("CHR2-ACT-17 writes one success audit", async () => {
    const target = await fixture(2, 2);
    await activate(target);
    await activate(target);
    const events = await database.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceId, target.chapter.chapterId),
          eq(auditLogs.action, "chapter.images.replaced"),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata).not.toHaveProperty("candidateStorageKey");
  });

  it("CHR2-ACT-18 enqueues exact purge/delete effects for old current media", async () => {
    const target = await fixture(3, 2);
    await activate(target);
    const effects = await database.db
      .select()
      .from(mediaEffectOutbox)
      .where(
        eq(
          mediaEffectOutbox.replacementOperationId,
          target.replacement.replacementId,
        ),
      );
    expect(effects).toHaveLength(6);
    expect(
      effects.filter((effect) => effect.effectType === "cdn_purge"),
    ).toHaveLength(3);
    expect(
      effects.filter((effect) => effect.effectType === "storage_delete"),
    ).toHaveLength(3);
  });

  it("CHR2-ACT-19 never emits purge_everything", async () => {
    const target = await fixture(1, 1);
    await activate(target);
    const effects = await database.db
      .select()
      .from(mediaEffectOutbox)
      .where(
        eq(
          mediaEffectOutbox.replacementOperationId,
          target.replacement.replacementId,
        ),
      );
    expect(
      effects.some(
        (effect) => effect.effectType === ("purge_everything" as never),
      ),
    ).toBe(false);
    expect(effects.every((effect) => effect.target !== "*")).toBe(true);
  });

  it("CHR2-ACT-20 publishes only new canonical URLs", async () => {
    const target = await fixture(2, 2);
    const before = await new GetPublishedChapter(
      new DrizzlePublishedChapterRepository(database.db),
      publicOrigin,
    ).execute(target.chapter.chapterId);
    await activate(target);
    const after = await new GetPublishedChapter(
      new DrizzlePublishedChapterRepository(database.db),
      publicOrigin,
    ).execute(target.chapter.chapterId);
    expect(after.images.map((image) => image.id)).toEqual(
      before.images.map((image) => image.id),
    );
    expect(
      after.images.every(
        (image, index) => image.url !== before.images[index]?.url,
      ),
    ).toBe(true);
  });
});
