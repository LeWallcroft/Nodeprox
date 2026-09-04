import { eq } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { DrizzleChapterMediaReplacementRepository } from "../../apps/api/src/modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-media-replacement.repository.js";
import { DrizzleMediaEffectRepository } from "../../apps/worker/src/media-effects/infrastructure/persistence/drizzle/media-effect.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  chapterReplacementItems,
  images,
  imageVersions,
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
  it("CHR2-SAFE-01 makes a superseded active key deletable after cutover", async () => {
    const target = await activated(1, 1);
    const safety = new DrizzleMediaEffectRepository(database.db);
    expect(
      await safety.isCurrentStorageKey(
        target.oldRows[0]?.imageId as string,
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
        retired?.currentStorageKey as string,
      ),
    ).toBe(false);
  });
});
