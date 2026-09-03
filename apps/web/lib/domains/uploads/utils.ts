export const ZIP_INPUT_ACCEPT =
  ".zip,application/zip,application/x-zip-compressed";

export const DEFAULT_MAX_ZIP_SIZE_BYTES = 512 * 1024 * 1024;
export const MAX_BULK_ZIP_FILES = 15;
export const MAX_BULK_ZIP_TOTAL_SIZE_BYTES = 3 * 1024 ** 3;

const ZIP_MIME_TYPES = new Set([
  "",
  "application/zip",
  "application/x-zip-compressed",
]);

export function isZipFile(file: File): boolean {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();

  return extension === ".zip" && ZIP_MIME_TYPES.has(file.type);
}

export function hasSafeZipFilename(file: File): boolean {
  return !/[\\/\0]/.test(file.name);
}

export type ZipSelectionMode = "single" | "bulk";

export type NormalizedZipSelection = {
  files: File[];
  message: string | null;
};

/**
 * Normalizes both picker and DataTransfer input. It is intentionally a UX
 * prevalidation; the API remains authoritative for file metadata and limits.
 */
export function normalizeSelectedZipFiles(
  files: Iterable<File>,
  input: {
    mode: ZipSelectionMode;
    maxFiles?: number;
    maxItemSizeBytes?: number;
    maxTotalSizeBytes?: number;
  },
): NormalizedZipSelection {
  const candidates = deduplicateZipFiles(Array.from(files));
  if (!candidates.length) return { files: [], message: null };
  const maxFiles =
    input.maxFiles ?? (input.mode === "single" ? 1 : MAX_BULK_ZIP_FILES);
  if (candidates.length > maxFiles)
    return {
      files: [],
      message:
        input.mode === "single"
          ? "Selecciona exactamente un archivo ZIP."
          : `Un batch admite como máximo ${maxFiles} archivos ZIP.`,
    };

  const valid = candidates.filter(
    (file) => isZipFile(file) && hasSafeZipFilename(file),
  );
  if (!valid.length)
    return {
      files: [],
      message: "Selecciona uno o más archivos ZIP válidos.",
    };
  const invalidCount = candidates.length - valid.length;
  const maxItemSizeBytes = input.maxItemSizeBytes ?? DEFAULT_MAX_ZIP_SIZE_BYTES;
  if (valid.some((file) => file.size <= 0 || file.size > maxItemSizeBytes))
    return {
      files: [],
      message: `Cada ZIP debe pesar entre 1 B y ${formatFileLimit(maxItemSizeBytes)}.`,
    };
  const total = valid.reduce((sum, file) => sum + file.size, 0);
  const maxTotalSizeBytes =
    input.maxTotalSizeBytes ?? MAX_BULK_ZIP_TOTAL_SIZE_BYTES;
  if (input.mode === "bulk" && total > maxTotalSizeBytes)
    return {
      files: [],
      message: `El tamaño total del batch no puede superar ${formatFileLimit(maxTotalSizeBytes)}.`,
    };
  return {
    files: valid,
    message: invalidCount
      ? `Se omitieron ${invalidCount} archivo${invalidCount === 1 ? "" : "s"} no válido${invalidCount === 1 ? "" : "s"}.`
      : null,
  };
}

export function nextDragDepth(
  current: number,
  event: "enter" | "leave" | "drop",
): number {
  if (event === "enter") return current + 1;
  if (event === "leave") return Math.max(0, current - 1);
  return 0;
}

function deduplicateZipFiles(files: readonly File[]): File[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    const identity = `${file.name}\0${file.size}\0${file.lastModified}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function formatFileLimit(bytes: number): string {
  if (bytes === MAX_BULK_ZIP_TOTAL_SIZE_BYTES) return "3 GiB";
  return `${Math.round(bytes / 1024 / 1024)} MiB`;
}
