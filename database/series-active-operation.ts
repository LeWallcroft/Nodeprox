import { and, eq, inArray, ne } from "drizzle-orm";
import type { NodeProxTransaction } from "./client.js";
import {
  chapterDeletionOutbox,
  chapterImportBatches,
  chapterImportItems,
  chapterReplacementOperations,
  chapterReplacementProcessingOutbox,
  chapters,
  imageReplacementOperations,
  processingOutbox,
  uploads,
} from "./schema/index.js";

/** Called only after locking the parent Series row. */
export async function hasSeriesActiveOperation(
  tx: NodeProxTransaction,
  seriesId: string,
): Promise<boolean> {
  const [activeChapter] = await tx
    .select({ id: chapters.id })
    .from(chapters)
    .where(
      and(
        eq(chapters.seriesId, seriesId),
        inArray(chapters.status, [
          "uploading",
          "uploaded",
          "processing",
          "deleting",
        ]),
      ),
    )
    .limit(1);
  if (activeChapter) return true;

  const [activeImport] = await tx
    .select({ id: chapterImportItems.id })
    .from(chapterImportItems)
    .innerJoin(
      chapterImportBatches,
      eq(chapterImportItems.batchId, chapterImportBatches.id),
    )
    .where(
      and(
        eq(chapterImportBatches.seriesId, seriesId),
        inArray(chapterImportItems.status, [
          "pending",
          "uploading",
          "validating",
          "uploaded",
          "processing",
        ]),
      ),
    )
    .limit(1);
  if (activeImport) return true;

  const [activeUpload] = await tx
    .select({ id: uploads.id })
    .from(uploads)
    .innerJoin(chapters, eq(uploads.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.seriesId, seriesId),
        inArray(uploads.status, [
          "pending",
          "verifying",
          "validating",
          "retry_exhausted",
          "aborting",
        ]),
      ),
    )
    .limit(1);
  if (activeUpload) return true;

  const [activeReplacement] = await tx
    .select({ id: chapterReplacementOperations.id })
    .from(chapterReplacementOperations)
    .innerJoin(
      chapters,
      eq(chapterReplacementOperations.chapterId, chapters.id),
    )
    .where(
      and(
        eq(chapters.seriesId, seriesId),
        inArray(chapterReplacementOperations.status, [
          "pending_upload",
          "uploaded",
          "validating",
          "retry_exhausted",
          "processing",
          "ready",
          "completing",
        ]),
      ),
    )
    .limit(1);
  if (activeReplacement) return true;

  const [activeImageReplacement] = await tx
    .select({ id: imageReplacementOperations.id })
    .from(imageReplacementOperations)
    .innerJoin(chapters, eq(imageReplacementOperations.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.seriesId, seriesId),
        inArray(imageReplacementOperations.status, [
          "pending_upload",
          "uploaded",
          "completing",
        ]),
      ),
    )
    .limit(1);
  if (activeImageReplacement) return true;

  const [pendingProcessing] = await tx
    .select({ id: processingOutbox.id })
    .from(processingOutbox)
    .where(
      and(
        eq(processingOutbox.seriesId, seriesId),
        eq(processingOutbox.status, "pending"),
      ),
    )
    .limit(1);
  if (pendingProcessing) return true;

  const [pendingReplacement] = await tx
    .select({ id: chapterReplacementProcessingOutbox.id })
    .from(chapterReplacementProcessingOutbox)
    .innerJoin(
      chapters,
      eq(chapterReplacementProcessingOutbox.chapterId, chapters.id),
    )
    .where(
      and(
        eq(chapters.seriesId, seriesId),
        eq(chapterReplacementProcessingOutbox.status, "pending"),
      ),
    )
    .limit(1);
  if (pendingReplacement) return true;

  const [pendingDeletion] = await tx
    .select({ id: chapterDeletionOutbox.id })
    .from(chapterDeletionOutbox)
    .innerJoin(chapters, eq(chapterDeletionOutbox.chapterId, chapters.id))
    .where(
      and(
        eq(chapters.seriesId, seriesId),
        ne(chapterDeletionOutbox.status, "completed"),
      ),
    )
    .limit(1);
  return Boolean(pendingDeletion);
}
