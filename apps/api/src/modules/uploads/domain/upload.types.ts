export type StoredObject = {
  key: string;
  sizeBytes: number;
  contentType: string;
  etag?: string;
};

export type UploadRecord = {
  id: string;
  chapterId: string;
  storageKey: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  etag: string | null;
  status: "pending" | "uploaded";
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ChapterUploadResult = {
  chapterId: string;
  uploadId: string;
  status: "uploaded";
  filename: string;
  sizeBytes: number;
};
