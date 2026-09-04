import { randomUUID } from "node:crypto";
import { MediaStorageKey } from "./media-storage-key.js";

const extensionByContentType = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

export class InvalidImageCandidateStorageKeyError extends Error {
  constructor() {
    super("Image candidate storage key input is invalid");
    this.name = "InvalidImageCandidateStorageKeyError";
  }
}

export function createImageCandidateStorageKey(input: {
  replacementId: string;
  currentStorageKey: string;
  contentType: string;
}) {
  const extension =
    extensionByContentType[
      input.contentType as keyof typeof extensionByContentType
    ];
  if (!extension || input.replacementId.trim().length === 0)
    throw new InvalidImageCandidateStorageKeyError();
  const current = MediaStorageKey.parseExisting(input.currentStorageKey);
  return MediaStorageKey.forPhysicalFilename({
    seriesSlug: current.seriesSlug,
    chapterPublicKey: current.chapterPublicKey,
    physicalFilename: `${input.replacementId}-${randomUUID()}.${extension}`,
  }).storageKey;
}
