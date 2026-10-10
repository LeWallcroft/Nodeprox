import type { ImportBatchProjection } from "../ingestion/types";
import type { BackgroundUploadOperation } from "./background-operations";

type UploadCenterBatch = {
  batchId: string;
  seriesId: string;
  seriesTitle: string;
  trackedAt: number;
  projection: ImportBatchProjection | null;
};

export type UploadCenterRecord = {
  id: string;
  kind: BackgroundUploadOperation["kind"];
  groupId: string | null;
  seriesId: string;
  seriesTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  filename: string;
  status: BackgroundUploadOperation["status"];
  warningCount: number;
  errorCode: string | null;
  failureStage: BackgroundUploadOperation["failureStage"];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  retryable: boolean;
  ephemeral: boolean;
  outcomeFingerprint: string;
  batchId: string | null;
  uploadId: string | null;
};

export function uploadOutcomeFingerprint(input: {
  id: string;
  status: string;
  updatedAt: string;
}): string {
  return `${input.id}:${input.status}:${input.updatedAt}`;
}

export function compareUploadCenterRecords(
  left: Pick<UploadCenterRecord, "createdAt" | "id">,
  right: Pick<UploadCenterRecord, "createdAt" | "id">,
): number {
  const byCreation = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  return byCreation || right.id.localeCompare(left.id);
}

export function mergeUploadCenterRecords(input: {
  operations: readonly BackgroundUploadOperation[];
  batches: readonly UploadCenterBatch[];
}): readonly UploadCenterRecord[] {
  const batchesByItem = new Map<string, UploadCenterBatch>();
  for (const batch of input.batches) {
    for (const item of batch.projection?.items ?? [])
      batchesByItem.set(item.itemId, batch);
  }

  const persisted = input.operations.map((operation) => {
    const batch =
      operation.kind === "chapter_import"
        ? batchesByItem.get(operation.id)
        : undefined;
    return makeRecord({
      id: operation.id,
      kind: operation.kind,
      groupId: batch?.batchId ?? null,
      seriesId: operation.seriesId,
      seriesTitle: operation.seriesTitle,
      chapterId: operation.chapterId,
      chapterNumber: operation.chapterNumber,
      filename: operation.filename,
      status: operation.status,
      warningCount: operation.warningCount,
      errorCode: operation.errorCode,
      failureStage: operation.failureStage,
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      completedAt: operation.completedAt,
      retryable:
        operation.kind === "chapter_import" &&
        operation.status === "failed" &&
        !isNonRetryableError(operation.errorCode),
      ephemeral: false,
      batchId: batch?.batchId ?? null,
      uploadId:
        batch?.projection?.items.find((item) => item.itemId === operation.id)
          ?.uploadId ?? null,
    });
  });

  const persistedIds = new Set(persisted.map((record) => record.id));
  const ephemeral: UploadCenterRecord[] = [];
  for (const batch of input.batches) {
    for (const item of batch.projection?.items ?? []) {
      if (persistedIds.has(item.itemId)) continue;
      const createdAt = new Date(batch.trackedAt).toISOString();
      ephemeral.push(
        makeRecord({
          id: item.itemId,
          kind: "chapter_import",
          groupId: batch.batchId,
          seriesId: batch.seriesId,
          seriesTitle: batch.seriesTitle,
          chapterId: item.chapterId,
          chapterNumber: item.chapterNumber,
          filename: item.filename,
          status: item.status,
          warningCount: item.warnings.length,
          errorCode: item.errorCode,
          failureStage:
            item.status === "rejected"
              ? "admission"
              : item.status === "failed"
                ? "processing"
                : null,
          createdAt,
          updatedAt: createdAt,
          completedAt: item.status === "ready" ? createdAt : null,
          retryable:
            item.status === "failed" && !isNonRetryableError(item.errorCode),
          ephemeral: true,
          batchId: batch.batchId,
          uploadId: item.uploadId,
        }),
      );
    }
  }
  return [...persisted, ...ephemeral].sort(compareUploadCenterRecords);
}

function makeRecord(
  record: Omit<UploadCenterRecord, "outcomeFingerprint">,
): UploadCenterRecord {
  return {
    ...record,
    outcomeFingerprint: uploadOutcomeFingerprint(record),
  };
}

function isNonRetryableError(errorCode: string | null): boolean {
  return [
    "chapter-upload-active",
    "chapter-uploaded",
    "chapter-processing",
    "chapter-ready",
    "chapter-failed",
    "chapter-deleting",
    "chapter-media-exists",
    "import-batch-item-conflict",
    "authorization-denied",
    "resource-not-found",
  ].includes(errorCode ?? "");
}
