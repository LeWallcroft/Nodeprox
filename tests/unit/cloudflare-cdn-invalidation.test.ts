import { describe, expect, it, vi } from "vitest";
import { CloudflareCdnInvalidationAdapter } from "../../apps/worker/src/media-effects/infrastructure/cloudflare-cdn-invalidation.adapter.js";
import { CdnInvalidationError } from "../../apps/worker/src/media-effects/application/ports.js";

describe("CloudflareCdnInvalidationAdapter", () => {
  it("purges only the exact requested URL", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    await new CloudflareCdnInvalidationAdapter(
      "zone-id",
      "secret-token",
      fetcher,
    ).purgeUrls(["https://media.example.test/raven/1/00.jpg"]);

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      files: ["https://media.example.test/raven/1/00.jpg"],
    });
    expect(String(init?.body)).not.toContain("purge_everything");
  });

  it("classifies 429 as retryable", async () => {
    const adapter = new CloudflareCdnInvalidationAdapter(
      "zone-id",
      "secret-token",
      vi.fn(async () => new Response(null, { status: 429 })),
    );
    await expect(
      adapter.purgeUrls(["https://media.example.test/raven/1/00.jpg"]),
    ).rejects.toMatchObject({
      code: "cdn-rate-limited",
      retryable: true,
    });
  });

  it("does not expose the token for authorization failures", async () => {
    const token = "must-never-leak";
    const adapter = new CloudflareCdnInvalidationAdapter(
      "zone-id",
      token,
      vi.fn(async () => new Response(token, { status: 403 })),
    );
    let failure: unknown;
    try {
      await adapter.purgeUrls(["https://media.example.test/raven/1/00.jpg"]);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(CdnInvalidationError);
    expect(String(failure)).not.toContain(token);
    expect(failure).toMatchObject({
      code: "cdn-authorization-error",
      retryable: false,
    });
  });
});
