import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { NodeProxStorageConfig } from "@nodeprox/config";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  UploadTransferObjectNotFoundError,
  UploadTransferProviderError,
  type StoragePort,
  type StoredObject,
  type UploadTransferPort,
  type VerifiedUploadedObject,
} from "./port.js";

function requirePositiveSize(sizeBytes: number): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0)
    throw new Error("storage-size-must-be-positive");
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null &&
    "httpStatusCode" in error.$metadata &&
    error.$metadata.httpStatusCode === 404
  );
}

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
    requirePositiveSize(input.sizeBytes);
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
      if (isNotFound(error)) return false;
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
    requirePositiveSize(input.sizeBytes);
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
    if (sizeBytes !== input.sizeBytes) {
      await rm(target, { force: true });
      throw new Error("storage-size-mismatch");
    }
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

export class B2UploadTransfer implements UploadTransferPort {
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
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    this.bucket = config.B2_BUCKET;
  }

  async initiate(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
    expiresInSeconds: number;
  }) {
    requirePositiveSize(input.sizeBytes);
    try {
      const url = await getSignedUrl(
        this.client,
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.sizeBytes,
        }),
        { expiresIn: input.expiresInSeconds },
      );
      return {
        mode: "single" as const,
        method: "PUT" as const,
        url,
        headers: { "content-type": input.contentType },
        expiresAt: new Date(
          Date.now() + input.expiresInSeconds * 1000,
        ).toISOString(),
      };
    } catch (cause) {
      throw new UploadTransferProviderError({ cause });
    }
  }

  async verify(input: { key: string }): Promise<VerifiedUploadedObject> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: input.key }),
      );
      const sizeBytes = result.ContentLength;
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes === undefined)
        throw new UploadTransferProviderError();
      const etag = result.ETag?.replaceAll('"', "");
      return {
        key: input.key,
        sizeBytes,
        ...(result.ContentType ? { contentType: result.ContentType } : {}),
        ...(etag ? { etag } : {}),
      };
    } catch (cause) {
      if (cause instanceof UploadTransferProviderError) throw cause;
      if (isNotFound(cause)) throw new UploadTransferObjectNotFoundError();
      throw new UploadTransferProviderError({ cause });
    }
  }

  async abort(input: { key: string }): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: input.key }),
      );
    } catch (cause) {
      throw new UploadTransferProviderError({ cause });
    }
  }
}
