import { MediaStorageKey } from "./media-storage-key.js";
import { MediaVersion } from "./media-version.js";

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
  currentStorageKey: string;
  logicalFilename: string;
  nextVersion: number;
  contentType: string;
}) {
  const extension =
    extensionByContentType[
      input.contentType as keyof typeof extensionByContentType
    ];
  if (
    !extension ||
    !Number.isSafeInteger(input.nextVersion) ||
    input.nextVersion <= 1
  )
    throw new InvalidImageCandidateStorageKeyError();
  const current = MediaStorageKey.parseExisting(input.currentStorageKey);
  return MediaStorageKey.forVersion({
    seriesSlug: current.seriesSlug,
    chapterPublicKey: current.chapterPublicKey,
    logicalFilename: withExtension(input.logicalFilename, extension),
    version: MediaVersion.parse(input.nextVersion),
  }).storageKey;
}

function withExtension(logicalFilename: string, extension: string): string {
  const dot = logicalFilename.lastIndexOf(".");
  if (
    dot <= 0 ||
    logicalFilename.includes("/") ||
    logicalFilename.includes("\\")
  )
    throw new InvalidImageCandidateStorageKeyError();
  return `${logicalFilename.slice(0, dot)}.${extension}`;
}
