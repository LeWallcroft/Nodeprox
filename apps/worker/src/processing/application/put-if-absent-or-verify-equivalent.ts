import { createHash } from "node:crypto";
import {
  StorageObjectAlreadyExistsError,
  type StoragePort,
  type StoredObject,
} from "@nodeprox/storage/port";

export type EquivalentWriteOutcome =
  | "created"
  | "existing-equivalent"
  | "existing-conflict";

export async function putIfAbsentOrVerifyEquivalent(input: {
  storage: StoragePort;
  key: string;
  body: NodeJS.ReadableStream;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  onCreated?: () => Promise<void>;
}): Promise<{ outcome: EquivalentWriteOutcome; key: string }> {
  let stored: StoredObject;
  try {
    stored = await input.storage.put({
      key: input.key,
      body: input.body,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
  } catch (error) {
    if (
      error instanceof StorageObjectAlreadyExistsError ||
      (error instanceof Error &&
        error.message === "storage-object-already-exists")
    ) {
      const equivalent = await verifyEquivalent(input);
      return {
        outcome: equivalent ? "existing-equivalent" : "existing-conflict",
        key: input.key,
      };
    }
    throw error;
  }
  await input.onCreated?.();
  if (
    stored.key !== input.key ||
    stored.sizeBytes !== input.sizeBytes ||
    stored.contentType !== input.contentType
  )
    throw new Error("stored-image-metadata-mismatch");
  if (!(await verifyEquivalent(input)))
    throw new Error("storage-verification-failed");
  return { outcome: "created", key: input.key };
}

async function verifyEquivalent(input: {
  storage: StoragePort;
  key: string;
  contentType: string;
  sizeBytes: number;
  checksum: string;
}): Promise<boolean> {
  const metadata = await input.storage.head?.(input.key);
  if (input.storage.head && !metadata) return false;
  if (
    metadata &&
    (metadata.sizeBytes !== input.sizeBytes ||
      (metadata.contentType && metadata.contentType !== input.contentType))
  )
    return false;
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of await input.storage.get(input.key)) {
    hash.update(chunk);
    sizeBytes += chunk.length;
  }
  return sizeBytes === input.sizeBytes && hash.digest("hex") === input.checksum;
}
