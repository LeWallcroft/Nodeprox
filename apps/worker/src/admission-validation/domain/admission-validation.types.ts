import type { MediaWarning } from "@nodeprox/types";

export type ValidationIssueCode =
  | "ZIP_INVALID"
  | "ZIP_INVALID_PATH"
  | "ZIP_INVALID_LAYOUT"
  | "ZIP_ENTRY_LIMIT_EXCEEDED"
  | "ZIP_TOTAL_SIZE_EXCEEDED"
  | "ZIP_COMPRESSION_RATIO_EXCEEDED"
  | "IMAGE_FILENAME_INVALID"
  | "IMAGE_DUPLICATE_FILENAME"
  | "IMAGE_DUPLICATE_SORT_ORDER"
  | "IMAGE_EXTENSION_UNSUPPORTED"
  | "IMAGE_MAGIC_MISMATCH"
  | "IMAGE_SIZE_EXCEEDED"
  | "IMAGE_WIDTH_EXCEEDED"
  | "IMAGE_HEIGHT_EXCEEDED"
  | "IMAGE_PIXELS_EXCEEDED"
  | "IMAGE_DIMENSIONS_UNREADABLE";

export type ValidationIssue = {
  code: ValidationIssueCode;
  severity: "error" | "warning";
  fileIndex?: number;
  filename?: string;
  actual?: Record<string, unknown>;
  expected?: Record<string, unknown>;
};

export type ValidatedChapterManifestEntry = {
  filename: string;
  extension: string;
  contentType: string;
  sortOrder: number;
  sizeBytes: number;
  checksumSha256: string;
  widthPx?: number;
  heightPx?: number;
  warnings: readonly MediaWarning[];
};

export type ValidatedChapterManifest = readonly ValidatedChapterManifestEntry[];

export type AdmissionValidationResult =
  | {
      outcome: "accepted";
      manifest: ValidatedChapterManifest;
      issues: readonly ValidationIssue[];
    }
  | { outcome: "rejected"; issues: readonly ValidationIssue[] };
