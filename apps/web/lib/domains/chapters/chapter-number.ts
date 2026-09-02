const CHAPTER_NUMBER_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;

export function normalizeChapterNumber(value: string): string | null {
  const trimmed = value.trim();
  if (!CHAPTER_NUMBER_PATTERN.test(trimmed)) return null;
  const [whole, fraction] = trimmed.split(".");
  if (!whole) return null;
  const canonical = fraction?.replace(/0+$/, "");
  return canonical ? `${whole}.${canonical}` : whole;
}

export function parseChapterNumber(value: string): number | null {
  const canonical = normalizeChapterNumber(value);
  return canonical === null ? null : Number(canonical);
}
