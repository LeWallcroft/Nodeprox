import type { MediaWarning } from "@nodeprox/types";
import type { InitiatedUpload } from "../uploads/types";

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
  resolution?: ImportTargetResolution;
};

export type ImportTargetResolution = "created" | "reused" | "conflict";

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
        resolution: "created" | "reused";
        transfer: InitiatedUpload["transfer"];
      }
    | {
        itemId: string;
        clientId: string;
        chapterNumber: number;
        chapterId?: string;
        status: "failed";
        resolution: ImportTargetResolution;
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
    resolution: ImportTargetResolution | null;
    warnings: readonly MediaWarning[];
  }[];
};

export type RetriedImportItem = {
  itemId: string;
  clientId: string;
  chapterId: string;
  uploadId: string;
  status: "uploading";
  resolution: "created" | "reused";
  transfer: InitiatedUpload["transfer"];
};
