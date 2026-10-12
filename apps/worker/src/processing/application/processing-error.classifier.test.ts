import { describe, expect, it } from "vitest";
import {
  StorageObjectNotFoundError,
  StorageProviderUnavailableError,
} from "@nodeprox/storage/errors";
import { ProcessingPermanentFailure } from "./processing.errors.js";
import {
  classifyProcessingError,
  sanitizeProcessingErrorMessage,
} from "./processing-error.classifier.js";

describe("classifyProcessingError", () => {
  it("prioritizes typed source and transient storage failures", () => {
    expect(
      classifyProcessingError(new StorageObjectNotFoundError()),
    ).toMatchObject({
      code: "SOURCE_OBJECT_MISSING",
      retryable: false,
    });
    expect(
      classifyProcessingError(
        new StorageProviderUnavailableError({
          providerCode: "InternalError",
          httpStatus: 500,
        }),
      ),
    ).toMatchObject({
      code: "STORAGE_WRITE_FAILED",
      retryable: true,
    });
    expect(
      classifyProcessingError(
        new ProcessingPermanentFailure("VALIDATION_MANIFEST_MISMATCH"),
      ),
    ).toMatchObject({
      code: "VALIDATION_MANIFEST_MISMATCH",
      retryable: false,
    });
  });
  it("finds SQLSTATE through a bounded cause chain", () => {
    expect(
      classifyProcessingError(
        new Error("wrapped", {
          cause: Object.assign(new Error("db"), { code: "40001" }),
        }),
      ),
    ).toMatchObject({
      code: "DB_PUBLICATION_FAILED",
      retryable: true,
    });
  });
  it.each([
    ["23505", false],
    ["23503", false],
    ["23514", false],
    ["40001", true],
    ["40P01", true],
  ] as const)("classifies SQLSTATE %s by code", (code, retryable) => {
    expect(
      classifyProcessingError(
        Object.assign(new Error("database error"), { code }),
      ),
    ).toMatchObject({ code: "DB_PUBLICATION_FAILED", retryable });
  });
  it.each([
    ["invalid-zip-layout", "ZIP_INVALID", false],
    ["image-magic-mismatch", "IMAGE_DECODE_FAILED", false],
    ["stored-image-metadata-mismatch", "STORAGE_WRITE_KEY_MISMATCH", false],
    ["chapter-ready-transition-conflict", "DB_PUBLICATION_FAILED", true],
    ["socket timeout", "PROCESSING_UNKNOWN", true],
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
