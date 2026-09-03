import type { ImportBatchProjection } from "../ingestion/types";
import type { ChapterStatus } from "./types";

const ACTIVE_CHAPTER_STATUSES = new Set<ChapterStatus>([
  "uploading",
  "uploaded",
  "processing",
]);

const ACTIVE_IMPORT_ITEM_STATUSES = new Set<
  ImportBatchProjection["items"][number]["status"]
>(["uploading", "uploaded", "processing"]);

export function isChapterLifecycleActive(status: ChapterStatus): boolean {
  return ACTIVE_CHAPTER_STATUSES.has(status);
}

export function hasActiveChapterLifecycle(
  chapters: readonly { status: ChapterStatus }[],
): boolean {
  return chapters.some((chapter) => isChapterLifecycleActive(chapter.status));
}

export function isImportItemLifecycleActive(
  status: ImportBatchProjection["items"][number]["status"],
): boolean {
  return ACTIVE_IMPORT_ITEM_STATUSES.has(status);
}

/**
 * Batch resolution is not lifecycle. Only server-persisted non-terminal item
 * lifecycle states keep the Upload Center polling.
 */
export function isImportBatchLifecycleActive(
  batch: ImportBatchProjection | undefined,
): boolean {
  return Boolean(
    batch?.items.some((item) => isImportItemLifecycleActive(item.status)),
  );
}
