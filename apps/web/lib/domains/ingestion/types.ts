import type { InitiatedUpload } from "../uploads/types";
import type { MediaWarning } from "@nodeprox/types";

export type ImportCandidate = {
  clientId: string;
  file: File;
  chapterNumber: number | null;
  status:
    | "pending"
    | "uploading"
    | "uploaded"
    | "processing"
    | "ready"
    | "failed";
  progress: number;
  error?: string;
  warnings?: readonly MediaWarning[];
  itemId?: string;
  chapterId?: string;
  uploadId?: string;
};

export type CreatedImportBatch = {
  batchId: string;
  status: "pending" | "running" | "completed" | "completed_with_errors";
  items: readonly (
    | {
        itemId: string;
        clientId: string;
        chapterNumber: number;
        chapterId: string;
        uploadId: string;
        status: "uploading";
        transfer: InitiatedUpload["transfer"];
      }
    | {
        itemId: string;
        clientId: string;
        chapterNumber: number;
        chapterId?: string;
        status: "failed";
        errorCode: string;
      }
  )[];
};

export type ImportBatchProjection = {
  batchId: string;
  status: "pending" | "running" | "completed" | "completed_with_errors";
  items: readonly {
    itemId: string;
    clientId: string;
    chapterNumber: number;
    chapterId: string | null;
    uploadId: string | null;
    status: ImportCandidate["status"];
    errorCode: string | null;
    warnings: readonly MediaWarning[];
  }[];
};

export type RetriedImportItem = {
  itemId: string;
  clientId: string;
  chapterId: string;
  uploadId: string;
  status: "uploading";
  transfer: InitiatedUpload["transfer"];
};
