import type { Readable } from "node:stream";
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
export interface ProcessingRepositoryPort {
  findUpload(uploadId: string): Promise<ProcessingUpload | null>;
  claimChapter(chapterId: string, uploadId: string): Promise<boolean>;
  replaceImagesAndMarkReady(
    chapterId: string,
    uploadId: string,
    images: ImageRecordInput[],
  ): Promise<void>;
  markFailed(
    chapterId: string,
    uploadId: string,
    terminal: boolean,
  ): Promise<void>;
  deleteImages(chapterId: string): Promise<void>;
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
