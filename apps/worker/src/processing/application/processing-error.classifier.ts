import {
  StorageError,
  StorageObjectNotFoundError,
} from "@nodeprox/storage/errors";

export type ProcessingErrorCode =
  | "SOURCE_OBJECT_MISSING"
  | "SOURCE_OBJECT_INVALID"
  | "ZIP_INVALID"
  | "ZIP_READ_FAILED"
  | "IMAGE_DECODE_FAILED"
  | "IMAGE_PROCESSING_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_WRITE_KEY_MISMATCH"
  | "STORAGE_VERIFY_FAILED"
  | "MANIFEST_INVALID"
  | "DB_PUBLICATION_FAILED"
  | "PROCESSING_UNKNOWN"
  | "VALIDATION_MANIFEST_MISMATCH"
  | "SOURCE_OBJECT_CHANGED";

export type ProcessingFailureClassification = {
  code: ProcessingErrorCode;
  retryable: boolean;
  message: string;
};

const zipInvalidMessages = new Set([
  "zip-entry-limit-exceeded",
  "invalid-zip-path",
  "invalid-zip-layout",
  "duplicate-image-filename",
  "duplicate-image-sort-order",
  "zip-has-no-images",
]);

const imageInvalidMessages = new Set([
  "invalid-image-filename",
  "invalid-image-order",
  "unsupported-image-extension",
  "image-magic-mismatch",
]);

export function classifyProcessingError(
  error: unknown,
): ProcessingFailureClassification {
  const raw = error instanceof Error ? error.message : String(error);
  const message = sanitizeProcessingErrorMessage(raw);
  if (error instanceof StorageObjectNotFoundError)
    return { code: "SOURCE_OBJECT_MISSING", retryable: false, message };
  if (error instanceof StorageError)
    return {
      code: "STORAGE_WRITE_FAILED",
      retryable: error.retryable,
      message: error.code,
    };
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : undefined;
  if (code === "VALIDATION_MANIFEST_MISMATCH")
    return {
      code: "VALIDATION_MANIFEST_MISMATCH",
      retryable: false,
      message: code,
    };
  if (code === "40001" || code === "40P01")
    return { code: "DB_PUBLICATION_FAILED", retryable: true, message: code };
  if (code === "23505" || code === "23503" || code === "23514")
    return { code: "DB_PUBLICATION_FAILED", retryable: false, message: code };
  if (zipInvalidMessages.has(raw))
    return { code: "ZIP_INVALID", retryable: false, message };
  if (imageInvalidMessages.has(raw))
    return { code: "IMAGE_DECODE_FAILED", retryable: false, message };
  if (raw === "stored-image-metadata-mismatch")
    return {
      code: "STORAGE_WRITE_KEY_MISMATCH",
      retryable: false,
      message,
    };
  if (raw === "storage-key-content-conflict")
    return { code: "STORAGE_WRITE_KEY_MISMATCH", retryable: false, message };
  if (raw === "storage-verification-failed")
    return { code: "STORAGE_VERIFY_FAILED", retryable: true, message };
  if (
    raw === "storage-object-body-missing" ||
    raw === "storage-object-body-not-readable"
  )
    return { code: "SOURCE_OBJECT_MISSING", retryable: false, message };
  if (raw === "invalid-public-storage-identity")
    return { code: "MANIFEST_INVALID", retryable: false, message };
  if (
    raw === "chapter-ready-transition-conflict" ||
    raw === "chapter-attempt-transition-conflict"
  )
    return { code: "DB_PUBLICATION_FAILED", retryable: true, message };
  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "EAI_AGAIN")
    return { code: "STORAGE_WRITE_FAILED", retryable: true, message: code };
  return { code: "PROCESSING_UNKNOWN", retryable: true, message };
}

export function sanitizeProcessingErrorMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/[a-z]:\\[^'"\r\n]*/gi, "[redacted-path]")
    .replace(
      /(token|secret|password|cookie|authorization|signature)=?[^\s,;]*/gi,
      "$1=[redacted]",
    )
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 500);
}
