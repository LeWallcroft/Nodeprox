import { randomUUID } from "node:crypto";

const publicSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const extension = /^[a-z0-9]+$/;

export function createChapterCandidateIdentity(input: {
  seriesSlug: string;
  chapterPublicKey: string;
  replacementId: string;
  logicalFilename: string;
  version: number;
  extension: string;
}) {
  if (
    !publicSegment.test(input.seriesSlug) ||
    !publicSegment.test(input.chapterPublicKey) ||
    !input.replacementId.trim() ||
    !Number.isSafeInteger(input.version) ||
    input.version <= 0 ||
    !/^\d{2}\.(?:jpg|jpeg|png|webp|gif)$/.test(input.logicalFilename) ||
    !extension.test(input.extension)
  )
    throw new Error("invalid-chapter-candidate-key-input");
  const itemId = randomUUID();
  const dot = input.logicalFilename.lastIndexOf(".");
  const stem = input.logicalFilename.slice(0, dot);
  const physicalFilename =
    input.version === 1
      ? `${stem}.${input.extension}`
      : `${stem}_v${input.version}.${input.extension}`;
  return {
    itemId,
    physicalFilename,
    storageKey: `Media/${input.seriesSlug}/${input.chapterPublicKey}/${physicalFilename}`,
  };
}
