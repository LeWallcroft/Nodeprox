import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { B2Storage } from "@nodeprox/storage";
import { mapStorageProviderError } from "@nodeprox/storage/errors";

describe("storage error mapping", () => {
  it.each([
    [500, "InternalError", "STORAGE_PROVIDER_UNAVAILABLE", true],
    [503, "ServiceUnavailable", "STORAGE_PROVIDER_UNAVAILABLE", true],
    [429, "SlowDown", "STORAGE_RATE_LIMITED", true],
    [403, "AccessDenied", "STORAGE_AUTHENTICATION_FAILED", false],
    [404, "NoSuchKey", "STORAGE_OBJECT_NOT_FOUND", false],
  ] as const)("maps B2 %i/%s by metadata", (status, name, code, retryable) => {
    expect(
      mapStorageProviderError({
        name,
        $metadata: { httpStatusCode: status, requestId: "provider-request" },
      }),
    ).toMatchObject({
      code,
      retryable,
      httpStatus: status,
      providerCode: name,
      providerRequestId: "provider-request",
    });
  });

  it("opens a new body stream after a failed partial write", async () => {
    const adapter = new B2Storage({
      B2_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
      B2_REGION: "us-west-004",
      B2_BUCKET: "nodeprox",
      B2_KEY_ID: "key",
      B2_APPLICATION_KEY: "secret",
    });
    const streams: Readable[] = [];
    const send = vi.fn(async (command: { input: { Body?: Readable } }) => {
      if (!command.input.Body)
        throw { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } };
      streams.push(command.input.Body);
      await command.input.Body.read(2);
      if (streams.length === 1)
        throw { name: "InternalError", $metadata: { httpStatusCode: 500 } };
      return { ETag: '"etag"' };
    });
    Object.defineProperty(adapter, "client", { value: { send } });
    const open = vi.fn(() => Readable.from([Buffer.from("data")]));
    await expect(
      adapter.put({
        key: "uploads/source.zip",
        body: { sizeBytes: 4, open },
        sizeBytes: 4,
        contentType: "application/zip",
      }),
    ).resolves.toMatchObject({ etag: "etag", sizeBytes: 4 });
    expect(open).toHaveBeenCalledTimes(2);
    expect(streams[0]).not.toBe(streams[1]);
  });
});
