import { Readable } from "node:stream";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "../../apps/api/src/modules/uploads/application/ports/storage.ports.js";
import {
  UploadTransferObjectNotFoundError,
  UploadTransferProviderError,
} from "../../packages/storage/src/port.js";
import { B2Storage } from "../../apps/api/src/modules/uploads/infrastructure/storage/b2.storage.js";
import { FilesystemStorage } from "../../apps/api/src/modules/uploads/infrastructure/storage/filesystem.storage.js";
import { B2UploadTransfer } from "../../packages/storage/src/adapters.js";

const b2Config = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET: "nodeprox",
  B2_KEY_ID: "key-id",
  B2_APPLICATION_KEY: "application-secret",
};

describe("B2Storage contract", () => {
  it("rejects a declared zero-sized object before contacting B2", async () => {
    const adapter: StoragePort = new B2Storage(b2Config);
    const send = vi.fn();
    Object.defineProperty(adapter, "client", { value: { send } });
    await expect(
      adapter.put({
        key: "uploads/empty.zip",
        body: Readable.from([]),
        contentType: "application/zip",
        sizeBytes: 0,
      }),
    ).rejects.toThrow("storage-size-must-be-positive");
    expect(send).not.toHaveBeenCalled();
  });

  it("implements put, exists and delete without exposing credentials", async () => {
    const adapter: StoragePort = new B2Storage(b2Config);
    const send = vi
      .fn()
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockResolvedValueOnce({ ETag: '"etag-1"' })
      .mockResolvedValueOnce({
        ContentLength: 4,
        ContentType: "application/zip",
      })
      .mockResolvedValueOnce({});
    Object.defineProperty(adapter, "client", { value: { send } });

    const input = {
      key: "chapters/chapter/uploads/upload.zip",
      body: Readable.from([Buffer.from("PK\\x03\\x04")]),
      contentType: "application/zip",
      sizeBytes: 4,
    };
    const result = await adapter.put(input);
    expect(result).toMatchObject({
      key: "chapters/chapter/uploads/upload.zip",
      etag: "etag-1",
      sizeBytes: input.sizeBytes,
    });
    const putCommand = send.mock.calls[1]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(putCommand.input.ContentLength).toBe(input.sizeBytes);
    expect(putCommand.input.IfNoneMatch).toBeUndefined();
    expect(putCommand.input.Body).toBe(input.body);
    expect((input.body as Readable).readableFlowing).toBeNull();
    await expect(
      adapter.exists("chapters/chapter/uploads/upload.zip"),
    ).resolves.toBe(true);
    await expect(
      adapter.delete("chapters/chapter/uploads/upload.zip"),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(adapter)).not.toContain("application-secret");
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("returns false only for a not-found head response and rethrows other errors", async () => {
    const adapter: StoragePort = new B2Storage(b2Config);
    const send = vi
      .fn()
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });
    Object.defineProperty(adapter, "client", { value: { send } });
    await expect(adapter.exists("missing.zip")).resolves.toBe(false);

    const failure = new Error("storage unavailable");
    Object.defineProperty(adapter, "client", {
      value: { send: vi.fn().mockRejectedValue(failure) },
    });
    await expect(adapter.exists("unknown.zip")).rejects.toBe(failure);
  });

  it("normalizes an existing B2 object without overwriting it", async () => {
    const adapter: StoragePort = new B2Storage(b2Config);
    const send = vi
      .fn()
      .mockResolvedValue({ ContentLength: 3, ContentType: "image/jpeg" });
    Object.defineProperty(adapter, "client", {
      value: { send },
    });
    await expect(
      adapter.put({
        key: "Media/a/1/01.jpg",
        body: Readable.from([Buffer.from("img")]),
        contentType: "image/jpeg",
        sizeBytes: 3,
      }),
    ).rejects.toMatchObject({
      name: "StorageObjectAlreadyExistsError",
      message: "storage-object-already-exists",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("reads a B2 object as a stream and preserves provider errors", async () => {
    const adapter: StoragePort = new B2Storage(b2Config);
    const body = Readable.from([Buffer.from("zip")]);
    const send = vi.fn().mockResolvedValue({ Body: body });
    Object.defineProperty(adapter, "client", { value: { send } });
    await expect(
      (await adapter.get("uploads/source.zip")).toArray(),
    ).resolves.toEqual([Buffer.from("zip")]);

    const failure = new Error("provider unavailable");
    Object.defineProperty(adapter, "client", {
      value: { send: vi.fn().mockRejectedValue(failure) },
    });
    await expect(adapter.get("uploads/source.zip")).rejects.toBe(failure);
  });
});

describe("FilesystemStorage contract", () => {
  it("normalizes an existing object and leaves its bytes unchanged", async () => {
    const root = await mkdtemp(`${tmpdir()}\\nodeprox-storage-test-`);
    try {
      const adapter: StoragePort = new FilesystemStorage(root);
      await adapter.put({
        key: "Media/a/1/01.jpg",
        body: Readable.from([Buffer.from("original")]),
        contentType: "image/jpeg",
        sizeBytes: 8,
      });
      await expect(
        adapter.put({
          key: "Media/a/1/01.jpg",
          body: Readable.from([Buffer.from("different")]),
          contentType: "image/jpeg",
          sizeBytes: 9,
        }),
      ).rejects.toMatchObject({
        name: "StorageObjectAlreadyExistsError",
        message: "storage-object-already-exists",
      });
      expect(
        Buffer.concat(await (await adapter.get("Media/a/1/01.jpg")).toArray()),
      ).toEqual(Buffer.from("original"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("reads objects as streams and rejects traversal", async () => {
    const root = await mkdtemp(`${tmpdir()}\\nodeprox-storage-test-`);
    try {
      const adapter: StoragePort = new FilesystemStorage(root);
      await adapter.put({
        key: "uploads/source.zip",
        body: Readable.from([Buffer.from("zip")]),
        contentType: "application/zip",
        sizeBytes: 3,
      });
      await expect(
        (await adapter.get("uploads/source.zip")).toArray(),
      ).resolves.toEqual([Buffer.from("zip")]);
      await expect(adapter.get("../outside.zip")).rejects.toThrow(
        "Invalid storage key",
      );
      await expect(adapter.get("missing.zip")).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects zero and mismatched declared sizes without keeping an object", async () => {
    const root = await mkdtemp(`${tmpdir()}\\nodeprox-storage-test-`);
    try {
      const adapter: StoragePort = new FilesystemStorage(root);
      await expect(
        adapter.put({
          key: "uploads/zero.zip",
          body: Readable.from([]),
          contentType: "application/zip",
          sizeBytes: 0,
        }),
      ).rejects.toThrow("storage-size-must-be-positive");
      await expect(
        adapter.put({
          key: "uploads/mismatch.zip",
          body: Readable.from([Buffer.from("zip")]),
          contentType: "application/zip",
          sizeBytes: 4,
        }),
      ).rejects.toThrow("storage-size-mismatch");
      await expect(adapter.exists("uploads/mismatch.zip")).resolves.toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("B2 direct upload transfer", () => {
  it("creates an object-scoped temporary PUT grant without permanent credentials", async () => {
    const adapter = new B2UploadTransfer(b2Config);
    const grant = await adapter.initiate({
      key: "uploads/series/chapter/upload.zip",
      contentType: "application/zip",
      sizeBytes: 4,
      expiresInSeconds: 60,
    });
    expect(grant).toMatchObject({
      mode: "single",
      method: "PUT",
      headers: { "content-type": "application/zip" },
    });
    expect(JSON.stringify(grant)).not.toContain("application-secret");
    if (grant.mode === "single") {
      const url = new URL(grant.url);
      expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
      expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain(
        "content-length",
      );
      expect(url.pathname).toContain("upload.zip");
    }
  });

  it("verifies real HEAD metadata and normalizes provider failures", async () => {
    const adapter = new B2UploadTransfer(b2Config);
    Object.defineProperty(adapter, "client", {
      configurable: true,
      value: {
        send: vi.fn().mockResolvedValue({
          ContentLength: 4,
          ContentType: "application/zip",
          ETag: '"etag-1"',
        }),
      },
    });
    await expect(
      adapter.verify({ key: "uploads/object.zip" }),
    ).resolves.toEqual({
      key: "uploads/object.zip",
      sizeBytes: 4,
      contentType: "application/zip",
      etag: "etag-1",
    });

    Object.defineProperty(adapter, "client", {
      configurable: true,
      value: {
        send: vi.fn().mockRejectedValue({ $metadata: { httpStatusCode: 404 } }),
      },
    });
    await expect(
      adapter.verify({ key: "uploads/missing.zip" }),
    ).rejects.toBeInstanceOf(UploadTransferObjectNotFoundError);

    Object.defineProperty(adapter, "client", {
      configurable: true,
      value: { send: vi.fn().mockRejectedValue(new Error("AccessDenied")) },
    });
    await expect(
      adapter.verify({ key: "uploads/denied.zip" }),
    ).rejects.toBeInstanceOf(UploadTransferProviderError);
  });
});
