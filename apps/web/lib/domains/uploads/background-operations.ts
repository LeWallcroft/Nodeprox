import type { MediaWarning } from "@nodeprox/types";
import { apiRequestBrowser } from "../../api/browser";

export type BackgroundUploadOperation = {
  id: string;
  kind:
    | "chapter_import"
    | "chapter_upload"
    | "chapter_replacement"
    | "image_replacement";
  seriesId: string;
  seriesTitle: string;
  chapterId: string | null;
  chapterNumber: number | null;
  imageId: string | null;
  filename: string;
  status:
    | "pending"
    | "pending_upload"
    | "uploading"
    | "validating"
    | "rejected"
    | "retry_exhausted"
    | "terminal_failed"
    | "uploaded"
    | "processing"
    | "ready"
    | "completing"
    | "completed"
    | "failed";
  errorCode: string | null;
  warningCount: number;
  failureStage: "admission" | "storage" | "processing" | "database" | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export function listBackgroundUploadOperations() {
  return apiRequestBrowser<{ items: BackgroundUploadOperation[] }>(
    "/me/upload-operations?limit=100",
  );
}

export type UploadValidationReport = {
  validationRunId: string;
  requestId: string | null;
  status: string;
  issues: readonly {
    id: string;
    code: string;
    severity: string;
    fileIndex: number | null;
    filename: string | null;
    actual: Record<string, unknown> | null;
    expected: Record<string, unknown> | null;
  }[];
  warnings: readonly MediaWarning[];
};

export function getUploadValidationReport(
  kind: "chapter_import" | "chapter_upload" | "chapter_replacement",
  operationId: string,
) {
  return apiRequestBrowser<UploadValidationReport>(
    `/me/upload-operations/${kind}/${operationId}/validation-report`,
  );
}

export function retryBackgroundUploadOperation(
  kind: "chapter_import" | "chapter_upload" | "chapter_replacement",
  operationId: string,
) {
  return apiRequestBrowser<{
    status: "validating" | "uploaded";
    stage: "admission" | "processing";
  }>(`/me/upload-operations/${kind}/${operationId}/retry`, { method: "POST" });
}
