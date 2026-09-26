const publicSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function buildChapterMediaStorageKey(input: {
  seriesSlug: string;
  chapterPublicKey: string;
  physicalFilename: string;
}): string {
  if (
    !publicSegment.test(input.seriesSlug) ||
    !publicSegment.test(input.chapterPublicKey) ||
    input.physicalFilename.lastIndexOf(".") <= 0 ||
    input.physicalFilename.endsWith(".") ||
    input.physicalFilename.includes("/") ||
    input.physicalFilename.includes("\\")
  )
    throw new Error("invalid-chapter-media-storage-key");
  return `Media/${input.seriesSlug}/${input.chapterPublicKey}/${input.physicalFilename}`;
}
