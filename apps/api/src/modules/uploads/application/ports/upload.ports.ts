import type { UploadRecord, StoredObject } from "../../domain/upload.types.js";

export interface UploadRepositoryPort {
  createPending(input: {
    id: string;
    chapterId: string;
    storageKey: string;
    originalFilename: string;
    contentType: string;
    createdBy: string;
  }): Promise<UploadRecord>;
  markUploaded(id: string, stored: StoredObject): Promise<UploadRecord>;
  findActiveByChapterId(chapterId: string): Promise<UploadRecord | null>;
  removePending(id: string): Promise<void>;
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
