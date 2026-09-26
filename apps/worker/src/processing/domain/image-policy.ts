import type { MediaWarning } from "@nodeprox/types";
import { buildChapterMediaStorageKey } from "@nodeprox/storage";

export type ImageContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";
export type ValidatedImage = {
  filename: string;
  extension: string;
  contentType: ImageContentType;
  sortOrder: number;
  sizeBytes: number;
  checksum: string;
  warnings: readonly MediaWarning[];
  tempPath: string;
};
const allowed = new Map<string, ImageContentType>([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
]);
export function validateImageName(filename: string): {
  extension: string;
  sortOrder: number;
} {
  const match = /^(\d{2})\.(jpg|jpeg|png|webp|gif)$/.exec(filename);
  if (!match) throw new Error("invalid-image-filename");
  const sortOrder = Number(match[1]);
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 0)
    throw new Error("invalid-image-order");
  return { extension: match[2] as string, sortOrder };
}
export function contentTypeForMagic(
  extension: string,
  magic: Uint8Array,
): ImageContentType {
  const contentType = allowed.get(extension);
  if (!contentType) throw new Error("unsupported-image-extension");
  const starts = (bytes: number[]) =>
    bytes.every((value, index) => magic[index] === value);
  const valid =
    contentType === "image/jpeg"
      ? starts([0xff, 0xd8, 0xff])
      : contentType === "image/png"
        ? starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        : contentType === "image/gif"
          ? Buffer.from(magic.subarray(0, 6)).toString() === "GIF87a" ||
            Buffer.from(magic.subarray(0, 6)).toString() === "GIF89a"
          : starts([0x52, 0x49, 0x46, 0x46]) &&
            Buffer.from(magic.subarray(8, 12)).toString() === "WEBP";
  if (!valid) throw new Error("image-magic-mismatch");
  return contentType;
}

export function dimensionsForHeader(
  contentType: ImageContentType,
  header: Uint8Array,
): { width: number; height: number } | null {
  const bytes = Buffer.from(header);
  if (contentType === "image/png" && bytes.length >= 24)
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  if (contentType === "image/gif" && bytes.length >= 10)
    return {
      width: bytes.readUInt16LE(6),
      height: bytes.readUInt16LE(8),
    };
  if (contentType === "image/jpeg") {
    let offset = 2;
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === undefined) return null;
      if (marker === 0xd8 || marker === 0xd9) {
        offset += 2;
        continue;
      }
      if (offset + 4 > bytes.length) return null;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length)
        return null;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      )
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      offset += 2 + segmentLength;
    }
    return null;
  }
  if (contentType !== "image/webp" || bytes.length < 30) return null;
  const chunk = bytes.subarray(12, 16).toString();
  if (chunk === "VP8X")
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  if (chunk === "VP8L" && bytes[20] === 0x2f) {
    const b1 = bytes[21] ?? 0;
    const b2 = bytes[22] ?? 0;
    const b3 = bytes[23] ?? 0;
    const b4 = bytes[24] ?? 0;
    return {
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + ((b2 & 0xc0) >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    };
  }
  if (
    chunk === "VP8 " &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  )
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  return null;
}
const publicStorageSegment = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function buildPermanentImageStorageKey(input: {
  seriesPublicSlug: string;
  chapterPublicKey: string;
  filename: string;
}): string {
  if (
    !publicStorageSegment.test(input.seriesPublicSlug) ||
    !publicStorageSegment.test(input.chapterPublicKey)
  )
    throw new Error("invalid-public-storage-identity");
  validateImageName(input.filename);
  return buildChapterMediaStorageKey({
    seriesSlug: input.seriesPublicSlug,
    chapterPublicKey: input.chapterPublicKey,
    physicalFilename: input.filename,
  });
}

export function mediaWarnings(input: {
  filename: string;
  sizeBytes: number;
  dimensions: { width: number; height: number } | null;
  warnImageBytes: number;
  warnWidthPx: number;
  warnHeightPx: number;
}): MediaWarning[] {
  const warnings: MediaWarning[] = [];
  if (input.sizeBytes > input.warnImageBytes)
    warnings.push({
      code: "large-file",
      filename: input.filename,
      sizeBytes: input.sizeBytes,
    });
  if (input.dimensions && input.dimensions.width > input.warnWidthPx)
    warnings.push({
      code: "wide-image",
      filename: input.filename,
      width: input.dimensions.width,
    });
  if (input.dimensions && input.dimensions.height > input.warnHeightPx)
    warnings.push({
      code: "tall-image",
      filename: input.filename,
      height: input.dimensions.height,
    });
  return warnings;
}
