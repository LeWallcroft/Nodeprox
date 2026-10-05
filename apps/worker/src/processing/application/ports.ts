import type { Readable } from "node:stream";
import type { ReplayableObjectBody } from "@nodeprox/storage/port";
import type { ChapterState } from "@nodeprox/types";
import type { ValidatedImage } from "../domain/image-policy.js";
import type { ValidatedChapterManifest } from "../../admission-validation/domain/admission-validation.types.js";
export type ProcessingUpload = {
  uploadId: string;
  chapterId: string;
  seriesId: string;
  seriesPublicSlug: string;
  chapterPublicKey: string;
  createdBy: string;
  storageKey: string;
  storageProfileId: string;
  status: string;
  chapterStatus: string;
};
export type ImageRecordInput = Omit<ValidatedImage, "tempPath"> & {
  storageKey: string;
  storageProfileId: string;
};
export type ProcessingAttemptStatus =
  | "processing"
  | "retryable_failed"
  | "retry_exhausted"
  | "terminal_failed"
  | "succeeded";
export type ProcessingAttempt = {
  id: string;
  chapterId: string;
  uploadId: string | null;
  validationRunId: string | null;
  storageProfileId: string;
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
  loadLatestAcceptedManifest(
    uploadId: string,
  ): Promise<ValidatedChapterManifest | null>;
  claimChapter(input: {
    chapterId: string;
    uploadId: string;
    jobId?: string;
    jobAttempt?: number;
  }): Promise<ProcessingClaimResult>;
  reserveCandidate(
    attemptId: string,
    storageKey: string,
    checksum: string,
  ): Promise<void>;
  markCandidate(
    attemptId: string,
    storageKey: string,
    status: "created" | "reused" | "cleaned",
  ): Promise<void>;
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
    failure: {
      disposition: "retryable" | "retry_exhausted" | "terminal";
      errorCode: string;
      errorMessage: string;
    },
    requestedByUserId: string,
  ): Promise<void>;
}
export interface ZipExtractorPort {
  inspect(source: Readable): Promise<ValidatedImage[]>;
  readImage(image: ValidatedImage): Readable;
  replayableImage(image: ValidatedImage): ReplayableObjectBody;
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
