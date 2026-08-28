export type HealthStatus = "ok";
export {
  InvalidAuditMetadataError,
  sanitizeAuditMetadata,
} from "./audit-metadata.js";
export type { AuditMetadata } from "./audit-metadata.js";

export interface RequestContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
}

export type ProcessChapterInput = {
  chapterId: string;
  seriesId: string;
  uploadId: string;
  sourceStorageKey: string;
};
export interface ProcessingQueuePort {
  enqueueChapterProcessing(input: ProcessChapterInput): Promise<void>;
}

export type DeleteChapterStorageInput = {
  deletionId: string;
  chapterId: string;
};

export interface ChapterDeletionQueuePort {
  enqueueChapterDeletion(input: DeleteChapterStorageInput): Promise<void>;
}

export type MediaWarning =
  | { code: "large-file"; filename: string; sizeBytes: number }
  | { code: "wide-image"; filename: string; width: number }
  | { code: "tall-image"; filename: string; height: number };

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: readonly unknown[];
}
