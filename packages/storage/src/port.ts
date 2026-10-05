import type { Readable } from "node:stream";
export { StorageObjectAlreadyExistsError } from "./errors.js";

export type StoredObject = {
  key: string;
  sizeBytes: number;
  contentType: string;
  etag?: string;
};

export type StoredObjectMetadata = {
  sizeBytes: number;
  contentType?: string;
};

export interface ReplayableObjectBody {
  readonly sizeBytes: number;
  open(): NodeJS.ReadableStream;
}

export interface StoragePort {
  put(input: {
    key: string;
    body: ReplayableObjectBody;
    contentType: string;
    sizeBytes: number;
  }): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  head?(key: string): Promise<StoredObjectMetadata | null>;
}

export type UploadTransferGrant =
  | {
      mode: "single";
      method: "PUT";
      url: string;
      headers: Readonly<Record<string, string>>;
      expiresAt: string;
    }
  | {
      mode: "multipart";
      partSizeBytes: number;
      parts: readonly {
        partNumber: number;
        method: "PUT";
        url: string;
        headers: Readonly<Record<string, string>>;
      }[];
      expiresAt: string;
    };

export type VerifiedUploadedObject = {
  key: string;
  sizeBytes: number;
  contentType?: string;
  etag?: string;
};

export interface UploadTransferPort {
  initiate(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }): Promise<UploadTransferGrant>;
  verify(input: { key: string }): Promise<VerifiedUploadedObject>;
  abort(input: { key: string }): Promise<void>;
}

export class UploadTransferObjectNotFoundError extends Error {
  constructor() {
    super("Uploaded object was not found");
    this.name = "UploadTransferObjectNotFoundError";
  }
}

export class UploadTransferProviderError extends Error {
  constructor(options?: ErrorOptions) {
    super("Upload transfer provider failed", options);
    this.name = "UploadTransferProviderError";
  }
}
