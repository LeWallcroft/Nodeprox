export type ChapterReplacementItem = {
  id: string;
  operationId: string;
  sortOrder: number;
  candidateStorageKey: string;
  storageProfileId: string;
  physicalFilename: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  etag: string | null;
  storedAt: Date | null;
  resultImageId: string | null;
  resultImageVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};
