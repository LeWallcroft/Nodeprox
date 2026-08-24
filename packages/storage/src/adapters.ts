import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { NodeProxStorageConfig } from "@nodeprox/config";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { StoragePort, StoredObject } from "./port.js";

export class B2Storage implements StoragePort {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(
    config: Extract<NodeProxStorageConfig, { provider: "b2" }>["b2"],
  ) {
    this.client = new S3Client({
      endpoint: config.B2_ENDPOINT,
      region: config.B2_REGION,
      credentials: {
        accessKeyId: config.B2_KEY_ID,
        secretAccessKey: config.B2_APPLICATION_KEY,
      },
    });
    this.bucket = config.B2_BUCKET;
  }

  async put(input: {
    key: string;
    body: NodeJS.ReadableStream;
    contentType: string;
    sizeBytes: number;
  }): Promise<StoredObject> {
    const result = await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body as never,
        ContentType: input.contentType,
        ContentLength: input.sizeBytes,
      }),
    );
    const etag = result.ETag?.replaceAll('"', "");
    return {
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      ...(etag ? { etag } : {}),
    };
  }

  async get(key: string): Promise<Readable> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!result.Body) throw new Error("storage-object-body-missing");
    if (result.Body instanceof Readable) return result.Body;
    if (Symbol.asyncIterator in Object(result.Body))
      return Readable.from(result.Body as unknown as AsyncIterable<Uint8Array>);
    throw new Error("storage-object-body-not-readable");
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "$metadata" in error &&
        typeof error.$metadata === "object" &&
        error.$metadata !== null &&
        "httpStatusCode" in error.$metadata &&
        error.$metadata.httpStatusCode === 404
      )
        return false;
      throw error;
    }
  }
}

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
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
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

  async get(key: string): Promise<Readable> {
    const target = this.safePath(key);
    await access(target);
    return createReadStream(target);
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
