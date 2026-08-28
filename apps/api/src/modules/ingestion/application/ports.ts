import type { UploadTransferGrant } from "@nodeprox/storage/port";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import type { MediaWarning } from "@nodeprox/types";

export type ImportItemInput = {
  clientId: string;
  chapterNumber: number;
  filename: string;
  contentType: string;
  sizeBytes: number;
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
    | "uploaded"
    | "processing"
    | "ready"
    | "failed";
  errorCode: string | null;
  warnings: readonly MediaWarning[];
  createdAt: Date;
  updatedAt: Date;
};

export interface ImportBatchRepositoryPort {
  create(input: {
    id: string;
    seriesId: string;
    createdBy: string;
  }): Promise<void>;
  addItem(input: {
    batchId: string;
    clientId: string;
    chapterNumber: number;
    filename: string;
    chapterId?: string;
    uploadId?: string;
    status: ImportItemProjection["status"];
    errorCode?: string;
  }): Promise<string>;
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
          chapterId: string;
          filename: string;
        };
      }
    | { outcome: "not-found" | "conflict" }
  >;
  attachRetryUpload(input: {
    itemId: string;
    uploadId: string;
  }): Promise<boolean>;
  failRetry(input: { itemId: string; errorCode: string }): Promise<void>;
}

export interface ImportSeriesAccessPort {
  check(
    actor: AuthorizationContext,
    seriesId: string,
  ): Promise<"allowed" | "denied" | "not-found">;
}

export interface ImportChapterPort {
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
  }): Promise<{
    uploadId: string;
    transfer: UploadTransferGrant;
  }>;
  abort(input: {
    actor: AuthorizationContext;
    chapterId: string;
    uploadId: string;
  }): Promise<void>;
}
