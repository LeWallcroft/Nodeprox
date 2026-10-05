import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type PutObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { NodeProxStorageConfig } from "@nodeprox/config";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  mapStorageProviderError,
  StorageIntegrityError,
  StorageObjectNotFoundError,
} from "./errors.js";
import {
  UploadTransferObjectNotFoundError,
  UploadTransferProviderError,
  StorageObjectAlreadyExistsError,
  type StoragePort,
  type ReplayableObjectBody,
  type StoredObjectMetadata,
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
      maxAttempts: 1,
    });
    this.bucket = config.B2_BUCKET;
  }

  async put(input: {
    key: string;
    body: ReplayableObjectBody;
    contentType: string;
    sizeBytes: number;
  }): Promise<StoredObject> {
    requirePositiveSize(input.sizeBytes);
    // B2 does not document conditional PutObject writes. Chapter processing
    // serializes logical writers in PostgreSQL; this read prevents a retry
    // from replacing a key already present in B2.
    if (input.body.sizeBytes !== input.sizeBytes)
      throw new StorageIntegrityError();
    if (await this.exists(input.key))
      throw new StorageObjectAlreadyExistsError();
    let result: PutObjectCommandOutput | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        result = await this.client.send(
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: input.key,
            Body: input.body.open() as never,
            ContentType: input.contentType,
            ContentLength: input.sizeBytes,
          }),
        );
        break;
      } catch (error) {
        const mapped = mapStorageProviderError(error);
        if (!mapped.retryable || attempt === 3) throw mapped;
        await new Promise((resolve) =>
          setTimeout(resolve, 100 * 2 ** (attempt - 1)),
        );
      }
    }
    if (!result) throw new StorageIntegrityError();
    const etag = result.ETag?.replaceAll('"', "");
    return {
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      ...(etag ? { etag } : {}),
    };
  }

  async get(key: string): Promise<Readable> {
    let result: GetObjectCommandOutput;
    try {
      result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      throw mapStorageProviderError(error);
    }
    if (!result.Body) throw new StorageIntegrityError();
    if (result.Body instanceof Readable) return result.Body;
    if (Symbol.asyncIterator in Object(result.Body))
      return Readable.from(result.Body as unknown as AsyncIterable<Uint8Array>);
    throw new StorageIntegrityError();
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      throw mapStorageProviderError(error);
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async head(key: string): Promise<StoredObjectMetadata | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (result.ContentLength === undefined) throw new StorageIntegrityError();
      return {
        sizeBytes: result.ContentLength,
        ...(result.ContentType ? { contentType: result.ContentType } : {}),
      };
    } catch (error) {
      const mapped = mapStorageProviderError(error);
      if (mapped instanceof StorageObjectNotFoundError) return null;
      throw mapped;
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
    body: ReplayableObjectBody;
    contentType: string;
    sizeBytes: number;
  }): Promise<StoredObject> {
    requirePositiveSize(input.sizeBytes);
    if (input.body.sizeBytes !== input.sizeBytes)
      throw new StorageIntegrityError();
    const target = this.safePath(input.key);
    await mkdir(dirname(target), { recursive: true });
    let sizeBytes = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        sizeBytes += chunk.length;
        callback(null, chunk);
      },
    });
    const output = createWriteStream(target, { flags: "wx" });
    let createdByThisWrite = false;
    output.once("open", () => {
      createdByThisWrite = true;
    });
    try {
      await pipeline(input.body.open(), counter, output);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EEXIST"
      )
        throw new StorageObjectAlreadyExistsError();
      if (createdByThisWrite) await rm(target, { force: true });
      throw error;
    }
    if (sizeBytes !== input.sizeBytes) {
      await rm(target, { force: true });
      throw new StorageIntegrityError();
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

  async head(key: string): Promise<StoredObjectMetadata | null> {
    try {
      const metadata = await stat(this.safePath(key));
      return { sizeBytes: metadata.size };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        return null;
      throw error;
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
