import type { StoredObject } from "../../domain/upload.types.js";

export interface StoragePort {
  put(input: {
    key: string;
    body: NodeJS.ReadableStream;
    contentType: string;
    sizeBytes: number;
  }): Promise<StoredObject>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
