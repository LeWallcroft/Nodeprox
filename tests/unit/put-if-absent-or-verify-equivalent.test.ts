import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { putIfAbsentOrVerifyEquivalent } from "../../apps/worker/src/processing/application/put-if-absent-or-verify-equivalent.js";
import type {
  PerformanceObserverPort,
  TimingSample,
} from "../../apps/worker/src/observability/application/performance-observer.port.js";
import {
  StorageObjectAlreadyExistsError,
  type StoragePort,
} from "@nodeprox/storage/port";

function setup() {
  let stored: Buffer | null = null;
  let contentType: string | null = null;
  const storage: StoragePort = {
    put: vi.fn(async (input) => {
      if (stored) throw new StorageObjectAlreadyExistsError();
      const chunks: Buffer[] = [];
      for await (const chunk of input.body.open())
        chunks.push(Buffer.from(chunk));
      stored = Buffer.concat(chunks);
      contentType = input.contentType;
      return {
        key: input.key,
        sizeBytes: stored.length,
        contentType: input.contentType,
      };
    }),
    get: vi.fn(async () => {
      if (!stored) throw new Error("missing-object");
      return Readable.from([stored]);
    }),
    head: vi.fn(async () =>
      stored
        ? { sizeBytes: stored.length, contentType: contentType ?? "" }
        : null,
    ),
    exists: vi.fn(async () => Boolean(stored)),
    delete: vi.fn(async () => {
      stored = null;
    }),
  };
  const write = (
    body: Buffer,
    type = "text/plain",
    onCreated?: () => Promise<void>,
    observer?: PerformanceObserverPort,
  ) =>
    putIfAbsentOrVerifyEquivalent({
      storage,
      key: "smoke-tests/example/object.txt",
      body: { sizeBytes: body.length, open: () => Readable.from([body]) },
      contentType: type,
      sizeBytes: body.length,
      checksum: createHash("sha256").update(body).digest("hex"),
      ...(onCreated ? { onCreated } : {}),
      ...(observer ? { observer } : {}),
    });
  return { storage, write, bytes: () => stored };
}

describe("putIfAbsentOrVerifyEquivalent", () => {
  it("creates and verifies a new object, recording ownership once", async () => {
    const target = setup();
    const onCreated = vi.fn().mockResolvedValue(undefined);
    await expect(
      target.write(Buffer.from("A"), "text/plain", onCreated),
    ).resolves.toEqual({
      outcome: "created",
      key: "smoke-tests/example/object.txt",
    });
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(target.bytes()).toEqual(Buffer.from("A"));
  });

  it("reuses equivalent content without another publication write", async () => {
    const target = setup();
    await target.write(Buffer.from("A"));
    const onCreated = vi.fn();
    await expect(
      target.write(Buffer.from("A"), "text/plain", onCreated),
    ).resolves.toMatchObject({
      outcome: "existing-equivalent",
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(target.bytes()).toEqual(Buffer.from("A"));
  });

  it("reports different bytes or content type as conflict without overwrite", async () => {
    const target = setup();
    await target.write(Buffer.from("A"));
    await expect(target.write(Buffer.from("B"))).resolves.toMatchObject({
      outcome: "existing-conflict",
    });
    await expect(
      target.write(Buffer.from("A"), "application/octet-stream"),
    ).resolves.toMatchObject({
      outcome: "existing-conflict",
    });
    expect(target.bytes()).toEqual(Buffer.from("A"));
    expect(target.storage.delete).not.toHaveBeenCalled();
  });

  it("does not claim success when read-back differs after creation", async () => {
    const target = setup();
    vi.mocked(target.storage.get).mockResolvedValue(
      Readable.from([Buffer.from("B")]),
    );
    await expect(target.write(Buffer.from("A"))).rejects.toThrow(
      "storage-verification-failed",
    );
  });

  it("measures only existing storage operations and counts complete verification reads", async () => {
    const target = setup();
    const samples: TimingSample[] = [];
    const observer: PerformanceObserverPort = {
      enabled: true,
      record: (sample) => {
        samples.push(sample);
      },
      finish: vi.fn(),
    };
    await target.write(Buffer.from("A"), "text/plain", undefined, observer);
    expect(target.storage.put).toHaveBeenCalledTimes(1);
    expect(target.storage.head).toHaveBeenCalledTimes(1);
    expect(target.storage.get).toHaveBeenCalledTimes(1);
    expect(samples.map((sample) => sample.stage)).toEqual([
      "storage.put_with_existence_check",
      "storage.verify_head",
      "storage.verify_get_sha256",
    ]);
    expect(samples[2]).toMatchObject({ bytes: 1, outcome: "success" });
    await target.write(Buffer.from("A"), "text/plain", undefined, observer);
    expect(target.storage.put).toHaveBeenCalledTimes(2);
    expect(target.storage.head).toHaveBeenCalledTimes(2);
    expect(target.storage.get).toHaveBeenCalledTimes(2);
    expect(samples[3]).toMatchObject({
      stage: "storage.put_with_existence_check",
      outcome: "error",
    });
    expect(samples[5]).toMatchObject({
      stage: "storage.verify_get_sha256",
      bytes: 1,
    });
  });

  it("waits for stream consumption and hashing before recording GET duration", async () => {
    const target = setup();
    let release: (() => void) | undefined;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(target.storage.get).mockImplementation(async () =>
      Readable.from(
        (async function* () {
          await pending;
          yield Buffer.from("A");
        })(),
      ),
    );
    const samples: TimingSample[] = [];
    const observer: PerformanceObserverPort = {
      enabled: true,
      record: (sample) => {
        samples.push(sample);
      },
      finish: vi.fn(),
    };
    const write = target.write(
      Buffer.from("A"),
      "text/plain",
      undefined,
      observer,
    );
    await vi.waitFor(() => expect(target.storage.get).toHaveBeenCalledOnce());
    expect(
      samples.some((sample) => sample.stage === "storage.verify_get_sha256"),
    ).toBe(false);
    release?.();
    await expect(write).resolves.toMatchObject({ outcome: "created" });
    expect(samples.at(-1)).toMatchObject({
      stage: "storage.verify_get_sha256",
      bytes: 1,
    });
  });
});
