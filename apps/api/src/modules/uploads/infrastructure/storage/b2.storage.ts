import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { NodeProxStorageConfig } from "@nodeprox/config";
import type { StoragePort } from "../../application/ports/storage.ports.js";
import type { StoredObject } from "../../domain/upload.types.js";

export class B2Storage implements StoragePort {
  private readonly client: S3Client;

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

  private readonly bucket: string;

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
