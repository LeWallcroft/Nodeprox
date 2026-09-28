import { randomUUID } from "node:crypto";
import type { NodeProxDatabase } from "../../../database/client.js";
import {
  chapterReplacementItems,
  chapterReplacementOperations,
  chapters,
  series,
  users,
} from "../../../database/schema/index.js";
import { insertImagesWithInitialVersions } from "./image-fixture.js";
import { legacyStorageProfileId } from "../../helpers/storage-execution.js";

export async function createReplacementChapter(
  db: NodeProxDatabase,
  imageCount: number,
) {
  const userId = randomUUID();
  const seriesId = randomUUID();
  const chapterId = randomUUID();
  const seriesSlug = `series-${seriesId}`;
  const chapterPublicKey = `chapter-${chapterId}`;
  await db.insert(users).values({
    id: userId,
    email: `${userId}@replacement.test`,
    passwordHash: "test-hash",
    status: "active",
    role: "admin",
  });
  await db.insert(series).values({
    id: seriesId,
    title: "Replacement Series",
    slug: seriesSlug,
    createdBy: userId,
  });
  await db.insert(chapters).values({
    id: chapterId,
    seriesId,
    chapterNumber: 1,
    publicKey: chapterPublicKey,
    status: "ready",
    createdBy: userId,
  });
  const imageIds: string[] = Array.from({ length: imageCount }, () =>
    randomUUID(),
  );
  await insertImagesWithInitialVersions(
    db,
    imageIds.map((id, index) => ({
      id,
      chapterId,
      filename: `old-${id}.jpg`,
      storageKey: `Media/${seriesSlug}/${chapterPublicKey}/old-${id}.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 100 + index,
      sortOrder: index + 1,
      checksum: `old-checksum-${id}`,
    })),
  );
  return {
    userId,
    seriesId,
    chapterId,
    seriesSlug,
    chapterPublicKey,
    imageIds,
  };
}

export async function createReadyReplacement(
  db: NodeProxDatabase,
  chapter: Awaited<ReturnType<typeof createReplacementChapter>>,
  imageCount: number,
  options: { sortOrders?: readonly number[]; retainedVersion?: number } = {},
) {
  const replacementId = randomUUID();
  await db.insert(chapterReplacementOperations).values({
    id: replacementId,
    chapterId: chapter.chapterId,
    requestedByUserId: chapter.userId,
    candidateZipStorageKey: `chapter-replacements/${chapter.chapterId}/${replacementId}/source.zip`,
    storageProfileId: legacyStorageProfileId,
    originalFilename: "replacement.zip",
    contentType: "application/zip",
    sizeBytes: 1000,
    etag: `zip-${replacementId}`,
    status: "ready",
  });
  const itemIds = Array.from({ length: imageCount }, () => randomUUID());
  if (imageCount > 0)
    await db.insert(chapterReplacementItems).values(
      itemIds.map((id, index) => {
        const retainedImageId = chapter.imageIds[index];
        const logicalFilename = retainedImageId
          ? `old-${retainedImageId}.jpg`
          : `page-${index + 1}.jpg`;
        const physicalFilename = retainedImageId
          ? logicalFilename.replace(
              /\.jpg$/,
              `_v${options.retainedVersion ?? 2}.jpg`,
            )
          : logicalFilename;
        return {
          id,
          operationId: replacementId,
          sortOrder: options.sortOrders?.[index] ?? index + 1,
          candidateStorageKey: `Media/${chapter.seriesSlug}/${chapter.chapterPublicKey}/${physicalFilename}`,
          storageProfileId: legacyStorageProfileId,
          physicalFilename,
          originalFilename: logicalFilename,
          contentType: "image/jpeg",
          sizeBytes: 200 + index,
          checksum: `candidate-checksum-${id}`,
          etag: `candidate-etag-${id}`,
          storedAt: new Date(),
        };
      }),
    );
  return { replacementId, itemIds };
}
