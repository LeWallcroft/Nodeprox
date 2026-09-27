import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { DrizzleChapterMediaReplacementRepository } from "../../apps/api/src/modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-media-replacement.repository.js";
import { DrizzleMediaEffectRepository } from "../../apps/worker/src/media-effects/infrastructure/persistence/drizzle/media-effect.repository.js";
import { DrizzleStorageCleanupRepository } from "../../apps/worker/src/storage-cleanup/infrastructure/persistence/drizzle/storage-cleanup.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  chapterReplacementItems,
  chapterReplacementOperations,
  images,
  imageVersions,
  mediaEffectOutbox,
  storageProfiles,
} from "../../database/schema/index.js";
import {
  createReadyReplacement,
  createReplacementChapter,
} from "./helpers/chapter-replacement-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const publicOrigin = "https://media.nodeprox.org";

afterAll(async () => database.sql.end());

async function activated(oldCount: number, newCount: number) {
  const chapter = await createReplacementChapter(database.db, oldCount);
  const oldRows = await database.db
    .select({ imageId: images.id, storageKey: imageVersions.storageKey })
    .from(images)
    .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
    .where(eq(images.chapterId, chapter.chapterId));
  const replacement = await createReadyReplacement(
    database.db,
    chapter,
    newCount,
  );
  const outcome = await new DrizzleChapterMediaReplacementRepository(
    database.db,
    publicOrigin,
  ).activate({
    replacementId: replacement.replacementId,
    chapterId: chapter.chapterId,
    actorUserId: chapter.userId,
  });
  if (outcome.outcome !== "completed")
    throw new Error(`activation-${outcome.outcome}`);
  return { chapter, replacement, oldRows };
}

describe("CHR2 canonical storage-delete safety", () => {
  it("preserves old A and new B physical lineage and judges B cleanup by the pair", async () => {
    const profileB = randomUUID();
    await database.db.insert(storageProfiles).values({
      id: profileB,
      provider: "b2",
      source: "managed",
      status: "draft",
      name: "Isolated profile fixture",
      publicHostnameLabel: `profile-${profileB.slice(0, 8)}`,
      publicHostname: `profile-${profileB.slice(0, 8)}.nodeprox.org`,
    });
    const chapter = await createReplacementChapter(database.db, 1);
    const imageId = chapter.imageIds[0] as string;
    const [oldVersion] = await database.db
      .select({ id: imageVersions.id, storageKey: imageVersions.storageKey })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(eq(images.id, imageId));
    if (!oldVersion) throw new Error("missing-old-version");
    const replacement = await createReadyReplacement(database.db, chapter, 1);
    await database.db
      .update(chapterReplacementOperations)
      .set({ storageProfileId: profileB })
      .where(eq(chapterReplacementOperations.id, replacement.replacementId));
    await database.db
      .update(chapterReplacementItems)
      .set({ storageProfileId: profileB })
      .where(
        eq(chapterReplacementItems.operationId, replacement.replacementId),
      );
    const outcome = await new DrizzleChapterMediaReplacementRepository(
      database.db,
      publicOrigin,
    ).activate({
      replacementId: replacement.replacementId,
      chapterId: chapter.chapterId,
      actorUserId: chapter.userId,
    });
    expect(outcome.outcome).toBe("completed");
    const versions = await database.db
      .select({
        id: imageVersions.id,
        storageProfileId: imageVersions.storageProfileId,
      })
      .from(imageVersions)
      .where(eq(imageVersions.imageId, imageId));
    expect(
      versions.find((row) => row.id === oldVersion.id)?.storageProfileId,
    ).toBe("00000000-0000-4000-8000-000000000001");
    expect(
      versions.find((row) => row.id !== oldVersion.id)?.storageProfileId,
    ).toBe(profileB);
    const [current] = await database.db
      .select({
        storageProfileId: images.storageProfileId,
        storageKey: imageVersions.storageKey,
      })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(eq(images.id, imageId));
    expect(current?.storageProfileId).toBe(profileB);
    if (!current) throw new Error("missing-current-version");
    const effects = await database.db
      .select({ storageProfileId: mediaEffectOutbox.storageProfileId })
      .from(mediaEffectOutbox)
      .where(
        eq(mediaEffectOutbox.replacementOperationId, replacement.replacementId),
      );
    expect(effects).toHaveLength(2);
    expect(
      effects.every(
        (effect) =>
          effect.storageProfileId === "00000000-0000-4000-8000-000000000001",
      ),
    ).toBe(true);

    const failedReplacementId = randomUUID();
    await database.db.insert(chapterReplacementOperations).values({
      id: failedReplacementId,
      chapterId: chapter.chapterId,
      requestedByUserId: chapter.userId,
      candidateZipStorageKey: `chapter-replacements/${failedReplacementId}/source.zip`,
      storageProfileId: profileB,
      originalFilename: "candidate.zip",
      contentType: "application/zip",
      sizeBytes: 1,
      status: "failed",
    });
    await database.db.insert(chapterReplacementItems).values({
      operationId: failedReplacementId,
      sortOrder: 1,
      candidateStorageKey: oldVersion.storageKey,
      storageProfileId: profileB,
      physicalFilename: "candidate.webp",
      originalFilename: "candidate.webp",
      contentType: "image/webp",
      sizeBytes: 1,
      checksum: "fixture",
    });
    const cleanup = new DrizzleStorageCleanupRepository(database.db);
    expect(
      await cleanup.isSafeToDelete({
        id: randomUUID(),
        replacementId: failedReplacementId,
        storageProfileId: profileB,
        storageKey: oldVersion.storageKey,
        reason: "replacement_failed_candidate",
        attempts: 1,
      }),
    ).toBe(true);

    // Same key in profile A is a different object, so the B cleanup is allowed.
    // When the exact (profile B, key) pair is canonical, cleanup must be blocked.
    await database.db
      .update(chapterReplacementOperations)
      .set({ status: "failed" })
      .where(eq(chapterReplacementOperations.id, replacement.replacementId));
    expect(
      await cleanup.isSafeToDelete({
        id: randomUUID(),
        replacementId: replacement.replacementId,
        storageProfileId: profileB,
        storageKey: current.storageKey,
        reason: "replacement_failed_candidate",
        attempts: 1,
      }),
    ).toBe(false);
  });

  it("CHR2-SAFE-01 makes a superseded active key deletable after cutover", async () => {
    const target = await activated(1, 1);
    const safety = new DrizzleMediaEffectRepository(database.db);
    expect(
      await safety.isCurrentStorageKey(
        target.oldRows[0]?.imageId as string,
        "00000000-0000-4000-8000-000000000001",
        target.oldRows[0]?.storageKey as string,
      ),
    ).toBe(false);
  });

  it("CHR2-SAFE-02 never permits deleting the new canonical key", async () => {
    const target = await activated(1, 1);
    const [item] = await database.db
      .select()
      .from(chapterReplacementItems)
      .where(
        eq(
          chapterReplacementItems.operationId,
          target.replacement.replacementId,
        ),
      );
    const safety = new DrizzleMediaEffectRepository(database.db);
    expect(
      await safety.isCurrentStorageKey(
        item?.resultImageId as string,
        "00000000-0000-4000-8000-000000000001",
        item?.candidateStorageKey as string,
      ),
    ).toBe(true);
  });

  it("CHR2-SAFE-03 permits cleanup of a retired Image old key", async () => {
    const target = await activated(2, 1);
    const retired = target.oldRows[1];
    const safety = new DrizzleMediaEffectRepository(database.db);
    expect(
      await safety.isCurrentStorageKey(
        retired?.imageId as string,
        "00000000-0000-4000-8000-000000000001",
        retired?.storageKey as string,
      ),
    ).toBe(false);
  });

  it("CHR2-SAFE-04 protects a key canonical for another active Image", async () => {
    const target = await activated(2, 2);
    const [active] = await database.db
      .select({ imageId: images.id, storageKey: imageVersions.storageKey })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(eq(images.chapterId, target.chapter.chapterId));
    const safety = new DrizzleMediaEffectRepository(database.db);
    expect(
      await safety.isCurrentStorageKey(
        "00000000-0000-0000-0000-000000000000",
        "00000000-0000-4000-8000-000000000001",
        active?.storageKey as string,
      ),
    ).toBe(true);
  });

  it("CHR2-SAFE-05 ignores a retired current_version_id as canonical authority", async () => {
    const target = await activated(2, 1);
    const retiredImageId = target.oldRows[1]?.imageId as string;
    const [retired] = await database.db
      .select({
        retiredAt: images.retiredAt,
        currentStorageKey: imageVersions.storageKey,
      })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(eq(images.id, retiredImageId));
    expect(retired?.retiredAt).not.toBeNull();
    expect(
      await new DrizzleMediaEffectRepository(database.db).isCurrentStorageKey(
        retiredImageId,
        "00000000-0000-4000-8000-000000000001",
        retired?.currentStorageKey as string,
      ),
    ).toBe(false);
  });
});
