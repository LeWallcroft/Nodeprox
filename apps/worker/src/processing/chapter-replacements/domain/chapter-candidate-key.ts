import { randomUUID } from "node:crypto";

const publicSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const extension = /^[a-z0-9]+$/;

export function createChapterCandidateIdentity(input: {
  seriesSlug: string;
  chapterPublicKey: string;
  replacementId: string;
  itemId?: string;
  extension: string;
}) {
  if (
    !publicSegment.test(input.seriesSlug) ||
    !publicSegment.test(input.chapterPublicKey) ||
    !input.replacementId.trim() ||
    !extension.test(input.extension)
  )
    throw new Error("invalid-chapter-candidate-key-input");
  const itemId = input.itemId ?? randomUUID();
  const physicalFilename = `${input.replacementId}-${itemId}.${input.extension}`;
  return {
    itemId,
    physicalFilename,
    storageKey: `Media/${input.seriesSlug}/${input.chapterPublicKey}/${physicalFilename}`,
  };
}
