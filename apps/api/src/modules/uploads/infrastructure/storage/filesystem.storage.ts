import { createWriteStream } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StoragePort } from "../../application/ports/storage.ports.js";
import type { StoredObject } from "../../domain/upload.types.js";

export class FilesystemStorage implements StoragePort {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  async put(input: {
    key: string;
    body: NodeJS.ReadableStream;
    contentType: string;
    sizeBytes: number;
  }): Promise<StoredObject> {
    const target = this.safePath(input.key);
    await mkdir(dirname(target), { recursive: true });
    let sizeBytes = 0;
    const counter = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error: Error | null, data?: Buffer) => void,
      ) {
        sizeBytes += Buffer.byteLength(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      input.body,
      counter,
      createWriteStream(target, { flags: "wx" }),
    );
    return { key: input.key, sizeBytes, contentType: input.contentType };
  }

  async delete(key: string): Promise<void> {
    await rm(this.safePath(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const target = this.safePath(key);
    try {
      await access(target);
      return true;
    } catch {
      return false;
    }
  }

  private safePath(key: string): string {
    const normalized = normalize(key);
    if (isAbsolute(key) || normalized.startsWith(".."))
      throw new Error("Invalid storage key");
    const target = resolve(join(this.root, normalized));
    if (target !== this.root && !target.startsWith(`${this.root}${sep}`))
      throw new Error("Invalid storage key");
    return target;
  }
}
