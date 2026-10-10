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
  issueCount: number;
  fileCount: number | null;
  totalSizeBytes: number | null;
  errorCode: string | null;
  failureStage: BackgroundUploadOperation["failureStage"];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  activityAt: string;
  outcomeAt: string | null;
  retryable: boolean;
  ephemeral: boolean;
  outcomeFingerprint: string;
  batchId: string | null;
  uploadId: string | null;
};

export function canLoadValidationReport(
  record: Pick<UploadCenterRecord, "kind" | "status" | "failureStage">,
): boolean {
  if (record.kind === "image_replacement") return false;
  if (["pending", "pending_upload", "uploading"].includes(record.status))
    return false;
  if (record.status === "failed") return record.failureStage === "processing";
  return [
    "validating",
    "rejected",
    "uploaded",
    "processing",
    "ready",
    "retry_exhausted",
    "terminal_failed",
  ].includes(record.status);
}

export function uploadOutcomeFingerprint(input: {
  id: string;
  status: string;
  updatedAt: string;
  outcomeAt?: string | null;
}): string {
  if (!isTerminalStatus(input.status)) return `${input.id}:${input.status}`;
  return `${input.id}:${input.status}:${input.outcomeAt ?? input.updatedAt}`;
}

export function resolveUploadActivityAt(record: {
  status: string;
  updatedAt: string;
  completedAt: string | null;
}): string {
  if (record.status === "ready" || record.status === "completed")
    return record.completedAt ?? record.updatedAt;
  return record.updatedAt;
}

export function uploadCenterSummary(record: UploadCenterRecord): {
  label: string;
  tone: "success" | "warning" | "danger" | "info";
} {
  if (record.status === "ready" || record.status === "completed")
    return record.warningCount
      ? {
          label: `Completada con ${record.warningCount} advertencias`,
          tone: "warning",
        }
      : { label: "Completada", tone: "success" };
  if (record.status === "rejected")
    return {
      label: record.issueCount
        ? `Carga rechazada · ${record.issueCount} problemas`
        : "Carga rechazada",
      tone: "danger",
    };
  if (record.status === "retry_exhausted")
    return { label: "Requiere atención", tone: "warning" };
  if (record.status === "failed" || record.status === "terminal_failed")
    return { label: "No se pudo completar", tone: "danger" };
  if (record.status === "validating")
    return { label: "Validando archivo", tone: "info" };
  if (record.status === "processing")
    return { label: "Procesando", tone: "info" };
  if (record.status === "uploaded")
    return { label: "Archivo subido", tone: "info" };
  if (record.status === "completing")
    return { label: "Finalizando", tone: "info" };
  return { label: "Subiendo", tone: "info" };
}

export function compareUploadCenterRecords(
  left: Pick<UploadCenterRecord, "createdAt" | "id"> &
    Partial<Pick<UploadCenterRecord, "activityAt">>,
  right: Pick<UploadCenterRecord, "createdAt" | "id"> &
    Partial<Pick<UploadCenterRecord, "activityAt">>,
): number {
  const byActivity =
    Date.parse(right.activityAt ?? right.createdAt) -
    Date.parse(left.activityAt ?? left.createdAt);
  if (byActivity) return byActivity;
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
      groupId: batch?.batchId ?? operation.batchId ?? null,
      seriesId: operation.seriesId,
      seriesTitle: operation.seriesTitle,
      chapterId: operation.chapterId,
      chapterNumber: operation.chapterNumber,
      filename: operation.filename,
      status: operation.status,
      warningCount: operation.warningCount,
      issueCount: operation.issueCount ?? 0,
      fileCount: operation.fileCount ?? null,
      totalSizeBytes: operation.totalSizeBytes ?? null,
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
      batchId: batch?.batchId ?? operation.batchId ?? null,
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
          issueCount: 0,
          fileCount: null,
          totalSizeBytes: null,
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
  record: Omit<
    UploadCenterRecord,
    "outcomeFingerprint" | "activityAt" | "outcomeAt"
  >,
): UploadCenterRecord {
  const outcomeAt = isTerminalStatus(record.status)
    ? (record.completedAt ?? record.updatedAt)
    : null;
  return {
    ...record,
    activityAt: resolveUploadActivityAt(record),
    outcomeAt,
    outcomeFingerprint: uploadOutcomeFingerprint({
      ...record,
      outcomeAt,
    }),
  };
}

function isTerminalStatus(status: string): boolean {
  return [
    "ready",
    "completed",
    "rejected",
    "failed",
    "retry_exhausted",
    "terminal_failed",
  ].includes(status);
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
