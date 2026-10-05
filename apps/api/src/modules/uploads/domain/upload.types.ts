import type {
  UploadTransferGrant,
  VerifiedUploadedObject,
} from "@nodeprox/storage/port";

export type { VerifiedUploadedObject as StoredObject };

export type UploadRecord = {
  id: string;
  chapterId: string;
  storageKey: string;
  storageProfileId: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  etag: string | null;
  status:
    | "pending"
    | "verifying"
    | "validating"
    | "retry_exhausted"
    | "aborting"
    | "uploaded"
    | "rejected"
    | "terminal_failed";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChapterUploadResult = {
  chapterId: string;
  uploadId: string;
  status: "validating";
  filename: string;
  sizeBytes: number;
};

export type InitiatedChapterUpload = {
  chapterId: string;
  uploadId: string;
  status: "pending";
  filename: string;
  sizeBytes: number;
  transfer: UploadTransferGrant;
};
