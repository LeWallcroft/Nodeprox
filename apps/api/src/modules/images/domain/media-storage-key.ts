import type { MediaVersion } from "./media-version.js";

const publicSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type VersionedMediaStorageKey = {
  storageKey: string;
  physicalFilename: string;
};

export class InvalidMediaStorageKeyInputError extends Error {
  constructor() {
    super("Media storage key input is invalid");
    this.name = "InvalidMediaStorageKeyInputError";
  }
}

export const MediaStorageKey = {
  forVersion(input: {
    seriesSlug: string;
    chapterPublicKey: string;
    logicalFilename: string;
    version: MediaVersion;
  }): VersionedMediaStorageKey {
    if (
      !publicSegment.test(input.seriesSlug) ||
      !publicSegment.test(input.chapterPublicKey)
    )
      throw new InvalidMediaStorageKeyInputError();

    const dot = input.logicalFilename.lastIndexOf(".");
    if (
      dot <= 0 ||
      dot === input.logicalFilename.length - 1 ||
      input.logicalFilename.includes("/") ||
      input.logicalFilename.includes("\\")
    )
      throw new InvalidMediaStorageKeyInputError();

    const version = input.version.toNumber();
    const stem = input.logicalFilename.slice(0, dot);
    const extension = input.logicalFilename.slice(dot);
    const physicalFilename =
      version === 1 ? input.logicalFilename : `${stem}_v${version}${extension}`;

    return {
      physicalFilename,
      storageKey: `Media/${input.seriesSlug}/${input.chapterPublicKey}/${physicalFilename}`,
    };
  },
} as const;
