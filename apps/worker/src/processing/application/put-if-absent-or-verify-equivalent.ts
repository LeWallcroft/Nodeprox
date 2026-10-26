import { createHash } from "node:crypto";
import {
  StorageObjectAlreadyExistsError,
  type StoragePort,
  type ReplayableObjectBody,
  type StoredObject,
} from "@nodeprox/storage/port";
import { measureStage } from "../../observability/application/measure-stage.js";
import type { PerformanceObserverPort } from "../../observability/application/performance-observer.port.js";

export type EquivalentWriteOutcome =
  | "created"
  | "existing-equivalent"
  | "existing-conflict";

export async function putIfAbsentOrVerifyEquivalent(input: {
  storage: StoragePort;
  key: string;
  body: ReplayableObjectBody;
  contentType: string;
  sizeBytes: number;
  checksum: string;
  onCreated?: () => Promise<void>;
  observer?: PerformanceObserverPort;
}): Promise<{ outcome: EquivalentWriteOutcome; key: string }> {
  let stored: StoredObject;
  try {
    stored = await measureStage(
      input.observer,
      "storage.put_with_existence_check",
      () =>
        input.storage.put({
          key: input.key,
          body: input.body,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        }),
      undefined,
      (error) =>
        error instanceof StorageObjectAlreadyExistsError
          ? "expected_existing"
          : "error",
    );
  } catch (error) {
    if (error instanceof StorageObjectAlreadyExistsError) {
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
  observer?: PerformanceObserverPort;
}): Promise<boolean> {
  const head = input.storage.head?.bind(input.storage);
  const metadata = head
    ? await measureStage(input.observer, "storage.verify_head", () =>
        head(input.key),
      )
    : undefined;
  if (input.storage.head && !metadata) return false;
  if (
    metadata &&
    (metadata.sizeBytes !== input.sizeBytes ||
      (metadata.contentType && metadata.contentType !== input.contentType))
  )
    return false;
  const hash = createHash("sha256");
  let sizeBytes = 0;
  let equivalent = false;
  await measureStage(
    input.observer,
    "storage.verify_get_sha256",
    async () => {
      for await (const chunk of await input.storage.get(input.key)) {
        hash.update(chunk);
        sizeBytes += chunk.length;
      }
      const digest = hash.digest("hex");
      equivalent = sizeBytes === input.sizeBytes && digest === input.checksum;
    },
    () => ({ bytes: sizeBytes, outcome: equivalent ? "success" : "error" }),
  );
  return equivalent;
}
