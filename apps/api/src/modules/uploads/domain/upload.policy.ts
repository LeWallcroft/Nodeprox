export function validateUploadMetadata(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
  maxSizeBytes: number;
  magicBytes: Uint8Array;
}): { filename: string } {
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
  if (input.contentType !== "application/zip")
    throw new InvalidUploadError("content-type");
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 0)
    throw new InvalidUploadError("size");
  if (input.sizeBytes > input.maxSizeBytes) throw new UploadTooLargeError();
  if (
    input.magicBytes.length < 4 ||
    input.magicBytes[0] !== 0x50 ||
    input.magicBytes[1] !== 0x4b
  )
    throw new InvalidUploadError("magic-bytes");
  return { filename };
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
