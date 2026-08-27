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
  if (input.contentType.trim().toLowerCase() !== "application/zip")
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
