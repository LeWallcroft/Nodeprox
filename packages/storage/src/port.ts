import type { Readable } from "node:stream";

export type StoredObject = {
  key: string;
  sizeBytes: number;
  contentType: string;
  etag?: string;
};

export interface StoragePort {
  put(input: {
    key: string;
    body: NodeJS.ReadableStream;
    contentType: string;
    sizeBytes: number;
  }): Promise<StoredObject>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
