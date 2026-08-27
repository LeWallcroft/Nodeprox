const SUPPORTED_ZIP_MIME_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
]);

export function isSupportedZipMimeType(mimeType: string): boolean {
  return SUPPORTED_ZIP_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function validateUploadMetadata(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
  maxSizeBytes: number;
}): { filename: string; contentType: "application/zip" } {
  const filename = input.filename.trim();
  if (
    !filename ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  )
    throw new InvalidUploadError("filename");
  if (
    filename === "." ||
    filename === ".." ||
    !filename.toLowerCase().endsWith(".zip")
  )
    throw new InvalidUploadError("extension");
  if (!isSupportedZipMimeType(input.contentType))
    throw new InvalidUploadError("content-type");
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes <= 0)
    throw new InvalidUploadError("size");
  if (input.sizeBytes > input.maxSizeBytes) throw new UploadTooLargeError();
  return { filename, contentType: "application/zip" };
}

export class InvalidUploadError extends Error {
  constructor(readonly reason: string) {
    super(`Invalid upload: ${reason}`);
    this.name = "InvalidUploadError";
  }
}

export class UploadTooLargeError extends Error {
  constructor() {
    super("Upload exceeds the configured maximum size");
    this.name = "UploadTooLargeError";
  }
}
