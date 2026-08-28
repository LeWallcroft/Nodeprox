import type { MediaWarning } from "@nodeprox/types";

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
  warnings: readonly MediaWarning[];
  createdAt: Date;
  updatedAt: Date;
};

export type ImageMetadata = Omit<ImageRecord, "storageKey">;
