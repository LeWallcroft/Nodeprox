export type AdmissionLimits = {
  maxEntries: number;
  maxTotalBytes: number;
  maxImageBytes: number;
  maxWidthPx?: number;
  maxHeightPx?: number;
  maxPixels?: number;
  maxCompressionRatio?: number;
  warnImageBytes: number;
  warnWidthPx: number;
  warnHeightPx: number;
};

export function isSafeZipPath(path: string): boolean {
  if (
    !path ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path)
  )
    return false;
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  return (
    normalized.length > 0 &&
    normalized
      .split("/")
      .every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}
