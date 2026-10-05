import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import { StorageError } from "@nodeprox/storage/errors";
import unzipper from "unzipper";
import {
  contentTypeForMagic,
  dimensionsForHeader,
  mediaWarnings,
  validateImageName,
} from "../../../processing/domain/image-policy.js";
import {
  type AdmissionLimits,
  isSafeZipPath,
} from "../../domain/admission-validation.policy.js";
import type {
  AdmissionValidationResult,
  ValidatedChapterManifestEntry,
  ValidationIssue,
  ValidationIssueCode,
} from "../../domain/admission-validation.types.js";

class AdmissionLimitError extends Error {
  constructor(
    readonly code: ValidationIssueCode,
    readonly fileIndex?: number,
    readonly filename?: string,
    readonly actual?: Record<string, unknown>,
    readonly expected?: Record<string, unknown>,
  ) {
    super(code);
  }
}

type ZipEntry = Readable & {
  path: string;
  type: string;
  vars?: { compressedSize?: number; uncompressedSize?: number };
};

export class ChapterZipInspector {
  constructor(private readonly limits: AdmissionLimits) {}

  async inspect(source: Readable): Promise<AdmissionValidationResult> {
    const parser = source.pipe(unzipper.Parse({ forceStream: true }));
    const issues: ValidationIssue[] = [];
    const manifest: ValidatedChapterManifestEntry[] = [];
    const names = new Set<string>();
    const orders = new Set<number>();
    let count = 0;
    let total = 0;
    let layout: "flat" | "wrapper" | undefined;
    let wrapper: string | undefined;
    try {
      for await (const entry of parser as AsyncIterable<ZipEntry>) {
        count += 1;
        if (count > this.limits.maxEntries)
          throw new AdmissionLimitError("ZIP_ENTRY_LIMIT_EXCEEDED", count);
        const path = entry.path;
        if (!isSafeZipPath(path))
          throw new AdmissionLimitError(
            "ZIP_INVALID_PATH",
            count,
            path.slice(0, 255),
          );
        const segments = path.replace(/\/$/, "").split("/");
        if (entry.type === "Directory") {
          if (
            segments.length !== 1 ||
            layout === "flat" ||
            (wrapper && wrapper !== segments[0])
          )
            throw new AdmissionLimitError(
              "ZIP_INVALID_LAYOUT",
              count,
              path.slice(0, 255),
            );
          layout = "wrapper";
          wrapper = segments[0];
          entry.resume();
          continue;
        }
        if (entry.type !== "File" || segments.length > 2)
          throw new AdmissionLimitError(
            "ZIP_INVALID_PATH",
            count,
            path.slice(0, 255),
          );
        const entryLayout = segments.length === 1 ? "flat" : "wrapper";
        if (
          (layout && layout !== entryLayout) ||
          (entryLayout === "wrapper" && wrapper && wrapper !== segments[0])
        )
          throw new AdmissionLimitError(
            "ZIP_INVALID_LAYOUT",
            count,
            path.slice(0, 255),
          );
        layout = entryLayout;
        if (entryLayout === "wrapper") wrapper = segments[0];
        const filename = (segments.at(-1) ?? "").slice(0, 255);
        const fileIssues: ValidationIssue[] = [];
        if (names.has(filename))
          fileIssues.push(issue("IMAGE_DUPLICATE_FILENAME", count, filename));
        names.add(filename);
        let identity: ReturnType<typeof validateImageName> | undefined;
        try {
          identity = validateImageName(filename);
        } catch {
          const extension = filename.split(".").at(-1)?.toLowerCase();
          fileIssues.push(
            issue(
              extension &&
                !["jpg", "jpeg", "png", "webp", "gif"].includes(extension)
                ? "IMAGE_EXTENSION_UNSUPPORTED"
                : "IMAGE_FILENAME_INVALID",
              count,
              filename,
            ),
          );
        }
        if (identity && orders.has(identity.sortOrder))
          fileIssues.push(issue("IMAGE_DUPLICATE_SORT_ORDER", count, filename));
        if (identity) orders.add(identity.sortOrder);
        const compressedSize = entry.vars?.compressedSize;
        const uncompressedSize = entry.vars?.uncompressedSize;
        if (
          this.limits.maxCompressionRatio !== undefined &&
          compressedSize !== undefined &&
          uncompressedSize !== undefined &&
          uncompressedSize / Math.max(1, compressedSize) >
            this.limits.maxCompressionRatio
        )
          throw new AdmissionLimitError(
            "ZIP_COMPRESSION_RATIO_EXCEEDED",
            count,
            filename,
            {
              compressionRatio: uncompressedSize / Math.max(1, compressedSize),
            },
            { maxCompressionRatio: this.limits.maxCompressionRatio },
          );
        const header = Buffer.alloc(262144);
        let headerLength = 0;
        let sizeBytes = 0;
        const hash = createHash("sha256");
        for await (const chunk of entry) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          sizeBytes += bytes.length;
          total += bytes.length;
          if (total > this.limits.maxTotalBytes)
            throw new AdmissionLimitError(
              "ZIP_TOTAL_SIZE_EXCEEDED",
              count,
              filename,
            );
          if (sizeBytes > this.limits.maxImageBytes)
            throw new AdmissionLimitError(
              "IMAGE_SIZE_EXCEEDED",
              count,
              filename,
              { sizeBytes },
              { maxImageBytes: this.limits.maxImageBytes },
            );
          const length = Math.min(bytes.length, header.length - headerLength);
          if (length > 0) bytes.copy(header, headerLength, 0, length);
          headerLength += length;
          hash.update(bytes);
        }
        if (identity) {
          let contentType: ReturnType<typeof contentTypeForMagic> | undefined;
          try {
            contentType = contentTypeForMagic(
              identity.extension,
              header.subarray(0, headerLength),
            );
          } catch {
            fileIssues.push(issue("IMAGE_MAGIC_MISMATCH", count, filename));
          }
          if (contentType) {
            const dimensions = dimensionsForHeader(
              contentType,
              header.subarray(0, headerLength),
            );
            if (!dimensions)
              fileIssues.push(
                issue("IMAGE_DIMENSIONS_UNREADABLE", count, filename),
              );
            if (
              dimensions &&
              this.limits.maxWidthPx !== undefined &&
              dimensions.width > this.limits.maxWidthPx
            )
              fileIssues.push(
                issue(
                  "IMAGE_WIDTH_EXCEEDED",
                  count,
                  filename,
                  { widthPx: dimensions.width },
                  { maxWidthPx: this.limits.maxWidthPx },
                ),
              );
            if (
              dimensions &&
              this.limits.maxHeightPx !== undefined &&
              dimensions.height > this.limits.maxHeightPx
            )
              fileIssues.push(
                issue(
                  "IMAGE_HEIGHT_EXCEEDED",
                  count,
                  filename,
                  { heightPx: dimensions.height },
                  { maxHeightPx: this.limits.maxHeightPx },
                ),
              );
            if (
              dimensions &&
              this.limits.maxPixels !== undefined &&
              dimensions.width * dimensions.height > this.limits.maxPixels
            )
              fileIssues.push(
                issue(
                  "IMAGE_PIXELS_EXCEEDED",
                  count,
                  filename,
                  { pixels: dimensions.width * dimensions.height },
                  { maxPixels: this.limits.maxPixels },
                ),
              );
            if (fileIssues.length === 0)
              manifest.push({
                filename,
                extension: identity.extension,
                contentType,
                sortOrder: identity.sortOrder,
                sizeBytes,
                checksumSha256: hash.digest("hex"),
                ...(dimensions
                  ? { widthPx: dimensions.width, heightPx: dimensions.height }
                  : {}),
                warnings: mediaWarnings({
                  filename,
                  sizeBytes,
                  dimensions,
                  warnImageBytes: this.limits.warnImageBytes,
                  warnWidthPx: this.limits.warnWidthPx,
                  warnHeightPx: this.limits.warnHeightPx,
                }),
              });
          }
        }
        issues.push(...fileIssues);
      }
    } catch (error) {
      if (error instanceof AdmissionLimitError)
        return {
          outcome: "rejected",
          issues: [
            ...issues,
            issue(
              error.code,
              error.fileIndex,
              error.filename,
              error.actual,
              error.expected,
            ),
          ],
        };
      if (error instanceof StorageError) throw error;
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        ["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"].includes(String(error.code))
      )
        throw error;
      return { outcome: "rejected", issues: [...issues, issue("ZIP_INVALID")] };
    }
    if (count === 0 || (manifest.length === 0 && issues.length === 0))
      issues.push(issue("ZIP_INVALID_LAYOUT"));
    return issues.some((item) => item.severity === "error")
      ? { outcome: "rejected", issues }
      : {
          outcome: "accepted",
          manifest: manifest.sort((a, b) => a.sortOrder - b.sortOrder),
          issues,
        };
  }
}

function issue(
  code: ValidationIssueCode,
  fileIndex?: number,
  filename?: string,
  actual?: Record<string, unknown>,
  expected?: Record<string, unknown>,
): ValidationIssue {
  return {
    code,
    severity: "error",
    ...(fileIndex !== undefined ? { fileIndex } : {}),
    ...(filename !== undefined ? { filename } : {}),
    ...(actual ? { actual } : {}),
    ...(expected ? { expected } : {}),
  };
}
