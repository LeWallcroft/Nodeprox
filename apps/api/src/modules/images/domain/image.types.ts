export type ImageRecord = {
  id: string;
  chapterId: string;
  filename: string;
  storageKey: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  sortOrder: number;
  checksum: string;
  createdAt: Date;
  updatedAt: Date;
};

export type ImageMetadata = Omit<ImageRecord, "storageKey">;
