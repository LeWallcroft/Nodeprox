import type { Readable } from "node:stream";
import type { ChapterState } from "@nodeprox/types";
import type { ValidatedImage } from "../domain/image-policy.js";
export type ProcessingUpload = {
  uploadId: string;
  chapterId: string;
  seriesId: string;
  seriesPublicSlug: string;
  chapterPublicKey: string;
  createdBy: string;
  storageKey: string;
  status: string;
  chapterStatus: string;
};
export type ImageRecordInput = Omit<ValidatedImage, "tempPath"> & {
  storageKey: string;
};
export type ProcessingAttemptStatus =
  | "processing"
  | "retryable_failed"
  | "terminal_failed"
  | "succeeded";
export type ProcessingAttempt = {
  id: string;
  chapterId: string;
  uploadId: string | null;
  jobId: string | null;
  jobAttempt: number | null;
  attemptNumber: number;
  status: ProcessingAttemptStatus;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};
export type ProcessingClaimResult =
  | { outcome: "claimed" | "resumed"; attempt: ProcessingAttempt }
  | { outcome: "finished"; attempt: ProcessingAttempt }
  | {
      outcome: "not-found" | "invalid-transition" | "concurrent-state-change";
      currentState?: ChapterState;
    };
export interface ProcessingRepositoryPort {
  findUpload(uploadId: string): Promise<ProcessingUpload | null>;
  claimChapter(input: {
    chapterId: string;
    uploadId: string;
    jobId?: string;
    jobAttempt?: number;
  }): Promise<ProcessingClaimResult>;
  replaceImagesAndMarkReady(
    chapterId: string,
    uploadId: string,
    attemptId: string,
    requestedByUserId: string,
    images: ImageRecordInput[],
  ): Promise<void>;
  markFailed(
    chapterId: string,
    uploadId: string,
    attemptId: string,
    failure: { terminal: boolean; errorCode: string; errorMessage: string },
    requestedByUserId: string,
  ): Promise<void>;
}
export interface ZipExtractorPort {
  inspect(source: Readable): Promise<ValidatedImage[]>;
  readImage(image: ValidatedImage): Readable;
  dispose(): Promise<void>;
}
export interface ProcessingAuditPort {
  append(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    result?: "success" | "rejected" | "failed";
    reasonCode?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
