import type { UploadTransferGrant } from "@nodeprox/storage/port";
import type { MediaWarning } from "@nodeprox/types";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";

export type ImportItemInput = {
  clientId: string;
  chapterNumber: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
};

export type ImportAdmissionLimitReason =
  | "bulk-active-series-limit"
  | "bulk-active-item-limit";

export type ChapterTargetResolutionKind = "created" | "reused" | "conflict";

export type ChapterConflictReason =
  | "chapter-upload-active"
  | "chapter-uploaded"
  | "chapter-processing"
  | "chapter-ready"
  | "chapter-failed"
  | "chapter-deleting"
  | "chapter-media-exists";

export type ChapterTargetResolution =
  | { kind: "created" | "reused"; chapterId: string }
  | {
      kind: "conflict";
      chapterId?: string;
      reason: ChapterConflictReason;
    };

export type ImportChapterTarget = {
  chapterId: string;
  status:
    | "draft"
    | "uploading"
    | "uploaded"
    | "processing"
    | "ready"
    | "failed"
    | "deleting";
  hasActiveUpload: boolean;
  hasUpload: boolean;
  hasMedia: boolean;
};

export type ImportItemProjection = {
  itemId: string;
  clientId: string;
  chapterNumber: number;
  filename: string;
  chapterId: string | null;
  uploadId: string | null;
  status:
    | "pending"
    | "uploading"
    | "validating"
    | "rejected"
    | "retry_exhausted"
    | "terminal_failed"
    | "uploaded"
    | "processing"
    | "ready"
    | "failed";
  errorCode: string | null;
  resolution: ChapterTargetResolutionKind | null;
  warnings: readonly MediaWarning[];
  createdAt: Date;
  updatedAt: Date;
};

export interface ImportBatchRepositoryPort {
  reserve(input: {
    id: string;
    seriesId: string;
    createdBy: string;
    items: readonly Pick<
      ImportItemInput,
      "clientId" | "chapterNumber" | "filename"
    >[];
  }): Promise<
    | {
        outcome: "reserved";
        items: readonly { itemId: string; clientId: string }[];
      }
    | { outcome: "limited"; reason: ImportAdmissionLimitReason }
  >;
  failReservation(input: { batchId: string; errorCode: string }): Promise<void>;
  attachUpload(input: { itemId: string; uploadId: string }): Promise<boolean>;
  updateResolution(input: {
    itemId: string;
    chapterId?: string;
    resolution: ChapterTargetResolutionKind;
    errorCode?: string | null;
    status?: ImportItemProjection["status"];
  }): Promise<boolean>;
  failItem(input: { itemId: string; errorCode: string }): Promise<void>;
  find(batchId: string): Promise<{
    id: string;
    seriesId: string;
    items: readonly ImportItemProjection[];
  } | null>;
  claimRetry(input: {
    seriesId: string;
    batchId: string;
    itemId: string;
  }): Promise<
    | {
        outcome: "claimed";
        item: {
          id: string;
          clientId: string;
          chapterId: string | null;
          chapterNumber: number;
          filename: string;
        };
      }
    | { outcome: "not-found" | "conflict" }
  >;
}

export interface ImportSeriesAccessPort {
  check(
    actor: AuthorizationContext,
    seriesId: string,
  ): Promise<"allowed" | "denied" | "not-found">;
}

export interface ImportChapterLookupPort {
  findTarget(
    seriesId: string,
    chapterNumber: number,
  ): Promise<ImportChapterTarget | null>;
}

export interface ImportChapterCreatePort {
  create(input: {
    actor: AuthorizationContext;
    seriesId: string;
    chapterNumber: number;
  }): Promise<
    | { outcome: "created"; chapterId: string }
    | { outcome: "denied" | "not-found" | "conflict" }
  >;
}

export interface ImportUploadPort {
  initiate(input: {
    actor: AuthorizationContext;
    chapterId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<
    | {
        outcome: "initiated";
        uploadId: string;
        transfer: UploadTransferGrant;
      }
    | { outcome: "conflict" }
  >;
  abort(input: {
    actor: AuthorizationContext;
    chapterId: string;
    uploadId: string;
  }): Promise<void>;
}
