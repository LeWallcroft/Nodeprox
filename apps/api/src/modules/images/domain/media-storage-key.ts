import type { MediaVersion } from "./media-version.js";

const publicSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type VersionedMediaStorageKey = {
  storageKey: string;
  physicalFilename: string;
};

export type ParsedMediaStorageKey = VersionedMediaStorageKey & {
  seriesSlug: string;
  chapterPublicKey: string;
  extension: string;
};

export class InvalidMediaStorageKeyInputError extends Error {
  constructor() {
    super("Media storage key input is invalid");
    this.name = "InvalidMediaStorageKeyInputError";
  }
}

export const MediaStorageKey = {
  forPhysicalFilename(input: {
    seriesSlug: string;
    chapterPublicKey: string;
    physicalFilename: string;
  }): VersionedMediaStorageKey {
    validateScope(input.seriesSlug, input.chapterPublicKey);
    const extension = parseExtension(input.physicalFilename);
    if (!extension) throw new InvalidMediaStorageKeyInputError();

    return {
      physicalFilename: input.physicalFilename,
      storageKey: `Media/${input.seriesSlug}/${input.chapterPublicKey}/${input.physicalFilename}`,
    };
  },

  forVersion(input: {
    seriesSlug: string;
    chapterPublicKey: string;
    logicalFilename: string;
    version: MediaVersion;
  }): VersionedMediaStorageKey {
    validateScope(input.seriesSlug, input.chapterPublicKey);
    const dot = input.logicalFilename.lastIndexOf(".");
    if (!parseExtension(input.logicalFilename))
      throw new InvalidMediaStorageKeyInputError();

    const version = input.version.toNumber();
    const stem = input.logicalFilename.slice(0, dot);
    const extension = input.logicalFilename.slice(dot);
    const physicalFilename =
      version === 1 ? input.logicalFilename : `${stem}_v${version}${extension}`;

    return this.forPhysicalFilename({
      seriesSlug: input.seriesSlug,
      chapterPublicKey: input.chapterPublicKey,
      physicalFilename,
    });
  },

  parseExisting(storageKey: string): ParsedMediaStorageKey {
    const parts = storageKey.split("/");
    if (parts.length !== 4 || parts[0] !== "Media")
      throw new InvalidMediaStorageKeyInputError();
    const [, seriesSlug, chapterPublicKey, physicalFilename] = parts;
    if (!seriesSlug || !chapterPublicKey || !physicalFilename)
      throw new InvalidMediaStorageKeyInputError();
    validateScope(seriesSlug, chapterPublicKey);
    const extension = parseExtension(physicalFilename);
    if (!extension) throw new InvalidMediaStorageKeyInputError();
    return {
      seriesSlug,
      chapterPublicKey,
      physicalFilename,
      extension,
      storageKey,
    };
  },
} as const;

function validateScope(seriesSlug: string, chapterPublicKey: string) {
  if (!publicSegment.test(seriesSlug) || !publicSegment.test(chapterPublicKey))
    throw new InvalidMediaStorageKeyInputError();
}

function parseExtension(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (
    dot <= 0 ||
    dot === filename.length - 1 ||
    filename.includes("/") ||
    filename.includes("\\")
  )
    return null;
  return filename.slice(dot + 1).toLowerCase();
}
