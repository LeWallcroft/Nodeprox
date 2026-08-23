import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { StoragePort } from "../../apps/api/src/modules/uploads/application/ports/storage.ports.js";
import { B2Storage } from "../../apps/api/src/modules/uploads/infrastructure/storage/b2.storage.js";

const b2Config = {
  B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
  B2_REGION: "us-west-004",
  B2_BUCKET: "nodeprox",
  B2_KEY_ID: "key-id",
  B2_APPLICATION_KEY: "application-secret",
};

describe("B2Storage contract", () => {
  it("implements put, exists and delete without exposing credentials", async () => {
    const adapter: StoragePort = new B2Storage(b2Config);
    const send = vi
      .fn()
      .mockResolvedValueOnce({ ETag: '"etag-1"' })
      .mockResolvedValueOnce({})
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
    const putCommand = send.mock.calls[0]?.[0] as {
      input: Record<string, unknown>;
    };
    expect(putCommand.input.ContentLength).toBe(input.sizeBytes);
    expect(putCommand.input.Body).toBe(input.body);
    expect((input.body as Readable).readableFlowing).toBeNull();
    await expect(
      adapter.exists("chapters/chapter/uploads/upload.zip"),
    ).resolves.toBe(true);
    await expect(
      adapter.delete("chapters/chapter/uploads/upload.zip"),
    ).resolves.toBeUndefined();
    expect(JSON.stringify(adapter)).not.toContain("application-secret");
    expect(send).toHaveBeenCalledTimes(3);
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
});
