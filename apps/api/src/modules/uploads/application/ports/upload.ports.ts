import type { VerifiedUploadedObject } from "@nodeprox/storage/port";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { UploadRecord } from "../../domain/upload.types.js";

export interface UploadRepositoryPort {
  createPending(input: {
    id: string;
    chapterId: string;
    storageKey: string;
    originalFilename: string;
    contentType: string;
    sizeBytes: number;
    createdBy: string;
  }): Promise<UploadRecord | null>;
  claimForCompletion(
    id: string,
    chapterId: string,
  ): Promise<UploadRecord | null>;
  releaseCompletion(id: string): Promise<void>;
  claimForAbort(id: string, chapterId: string): Promise<UploadRecord | null>;
  releaseAbort(id: string): Promise<void>;
  findActiveByChapterId(chapterId: string): Promise<UploadRecord | null>;
  findByIdAndChapterId(
    id: string,
    chapterId: string,
  ): Promise<UploadRecord | null>;
  removePending(id: string): Promise<boolean>;
  removeAborting(id: string): Promise<boolean>;
  recoverStaleClaims(cutoff: Date): Promise<void>;
  findStalePending(cutoff: Date, limit: number): Promise<UploadRecord[]>;
}

export type UploadFinalizationResult =
  | { outcome: "uploaded"; upload: UploadRecord }
  | { outcome: "denied" }
  | { outcome: "conflict" };

export type UploadAbortClaimResult =
  | { outcome: "claimed"; upload: UploadRecord }
  | { outcome: "denied" }
  | { outcome: "conflict" };

export interface UploadLifecycleBoundaryPort {
  finalizeIfAuthorized(input: {
    actor: AuthorizationContext;
    chapterId: string;
    uploadId: string;
    verifiedObject: VerifiedUploadedObject;
    originRequestId?: string;
  }): Promise<UploadFinalizationResult>;
  claimAbortIfAuthorized(input: {
    actor: AuthorizationContext;
    chapterId: string;
    uploadId: string;
  }): Promise<UploadAbortClaimResult>;
}

export interface UploadAuditPort {
  append(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    result?: "success" | "rejected" | "failed" | null;
    reasonCode?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
