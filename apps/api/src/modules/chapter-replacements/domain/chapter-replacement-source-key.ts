const identifier =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidChapterReplacementSourceKeyError extends Error {}

export function createChapterReplacementSourceKey(input: {
  chapterId: string;
  replacementId: string;
}): string {
  if (
    !identifier.test(input.chapterId) ||
    !identifier.test(input.replacementId)
  )
    throw new InvalidChapterReplacementSourceKeyError();
  return `chapter-replacements/${input.chapterId}/${input.replacementId}/source.zip`;
}
