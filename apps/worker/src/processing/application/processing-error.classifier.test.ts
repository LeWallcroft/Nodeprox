import { describe, expect, it } from "vitest";
import {
  classifyProcessingError,
  sanitizeProcessingErrorMessage,
} from "./processing-error.classifier.js";

describe("classifyProcessingError", () => {
  it.each([
    ["invalid-zip-layout", "ZIP_INVALID", false],
    ["image-magic-mismatch", "IMAGE_DECODE_FAILED", false],
    ["stored-image-metadata-mismatch", "STORAGE_WRITE_KEY_MISMATCH", false],
    ["chapter-ready-transition-conflict", "DB_PUBLICATION_FAILED", true],
    ["socket timeout", "STORAGE_WRITE_FAILED", true],
    ["unexpected", "PROCESSING_UNKNOWN", true],
  ] as const)("classifies %s", (message, code, retryable) => {
    expect(classifyProcessingError(new Error(message))).toEqual({
      code,
      retryable,
      message,
    });
  });

  it("sanitizes and bounds persisted diagnostics", () => {
    const message = sanitizeProcessingErrorMessage(
      `token=secret https://example.test/signed?signature=secret F:\\private\\source.zip\n${"x".repeat(800)}`,
    );
    expect(message).not.toContain("secret");
    expect(message).not.toContain("https://");
    expect(message).not.toContain("F:\\private");
    expect(message.length).toBeLessThanOrEqual(500);
  });
});
