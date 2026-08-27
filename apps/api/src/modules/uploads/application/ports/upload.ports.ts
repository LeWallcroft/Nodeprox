import type { UploadRecord, StoredObject } from "../../domain/upload.types.js";

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
  markUploaded(id: string, stored: StoredObject): Promise<UploadRecord | null>;
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

export interface UploadAuditPort {
  append(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}
