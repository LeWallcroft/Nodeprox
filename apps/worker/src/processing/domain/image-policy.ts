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
  if (!Number.isSafeInteger(sortOrder) || sortOrder < 1)
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
          ? Buffer.from(magic).toString() === "GIF87a" ||
            Buffer.from(magic).toString() === "GIF89a"
          : starts([0x52, 0x49, 0x46, 0x46]) &&
            Buffer.from(magic.subarray(8, 12)).toString() === "WEBP";
  if (!valid) throw new Error("image-magic-mismatch");
  return contentType;
}
export function permanentImageKey(
  seriesId: string,
  chapterId: string,
  filename: string,
): string {
  return `Media/${seriesId}/${chapterId}/${filename}`;
}
