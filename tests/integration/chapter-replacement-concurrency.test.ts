import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { DrizzleChapterMediaReplacementRepository } from "../../apps/api/src/modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-media-replacement.repository.js";
import {
  ActivateImageCandidateService,
  ImageCandidateActivationNotFoundError,
} from "../../apps/api/src/modules/images/application/services/activate-image-candidate.service.js";
import { DrizzleMediaReplacementRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/media-replacement.repository.js";
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

async function wholeFixture(oldCount = 1, newCount = 1) {
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

async function activateWhole(target: Awaited<ReturnType<typeof wholeFixture>>) {
  return target.repository.activate({
    replacementId: target.replacement.replacementId,
    chapterId: target.chapter.chapterId,
    actorUserId: target.chapter.userId,
  });
}

async function activateSingle(
  target: Awaited<ReturnType<typeof wholeFixture>>,
  imageId: string,
) {
  const operationId = randomUUID();
  const filename = `${operationId}.jpg`;
  return new ActivateImageCandidateService(
    new DrizzleMediaReplacementRepository(database.db),
    publicOrigin,
  ).execute({
    context: { userId: target.chapter.userId, sessionId: randomUUID() },
    imageId,
    candidateStorageKey: `Media/${target.chapter.seriesSlug}/${target.chapter.chapterPublicKey}/${filename}`,
    contentType: "image/jpeg",
    sizeBytes: 777,
    checksum: `single-${operationId}`,
    operationId,
  });
}

describe("CHR2 replacement concurrency", () => {
  it("CHR2-CON-01 converges concurrent activation of one operation", async () => {
    const target = await wholeFixture(2, 2);
    const results = await Promise.all([
      activateWhole(target),
      activateWhole(target),
    ]);
    expect(results[0]).toEqual(results[1]);
    const versions = await database.db
      .select()
      .from(imageVersions)
      .where(eq(imageVersions.imageId, target.chapter.imageIds[0] as string));
    expect(versions).toHaveLength(2);
  });

  it("CHR2-CON-02 rejects a second active whole replacement in PostgreSQL", async () => {
    const target = await wholeFixture();
    await expect(
      createReadyReplacement(database.db, target.chapter, 1),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("CHR2-CON-03 single then whole increments from latest version", async () => {
    const target = await wholeFixture();
    const imageId = target.chapter.imageIds[0] as string;
    await activateSingle(target, imageId);
    await activateWhole(target);
    const [current] = await database.db
      .select({ version: imageVersions.version })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(eq(images.id, imageId));
    expect(current?.version).toBe(3);
  });

  it("CHR2-CON-04 whole then single retained Image increments next version", async () => {
    const target = await wholeFixture();
    const imageId = target.chapter.imageIds[0] as string;
    await activateWhole(target);
    const single = await activateSingle(target, imageId);
    expect(single.version).toBe(3);
  });

  it("CHR2-CON-05 single replacement cannot target an Image retired by whole replacement", async () => {
    const target = await wholeFixture(2, 1);
    const retiredId = target.chapter.imageIds[1] as string;
    await activateWhole(target);
    await expect(activateSingle(target, retiredId)).rejects.toBeInstanceOf(
      ImageCandidateActivationNotFoundError,
    );
  });

  it("CHR2-CON-06 concurrent same-operation activation loses no current pointer update", async () => {
    const target = await wholeFixture(2, 2);
    await Promise.all([activateWhole(target), activateWhole(target)]);
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

  it("CHR2-CON-07 whole and single activation share lock order without deadlock", async () => {
    const target = await wholeFixture();
    const imageId = target.chapter.imageIds[0] as string;
    const results = await Promise.all([
      activateWhole(target),
      activateSingle(target, imageId),
    ]);
    expect(results).toHaveLength(2);
    const versions = await database.db
      .select()
      .from(imageVersions)
      .where(eq(imageVersions.imageId, imageId));
    expect(versions.map((version) => version.version).sort()).toEqual([
      1, 2, 3,
    ]);
  });
});
