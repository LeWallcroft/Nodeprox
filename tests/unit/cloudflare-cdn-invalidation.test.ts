import { describe, expect, it, vi } from "vitest";
import { CloudflareCdnInvalidationAdapter } from "../../apps/worker/src/media-effects/infrastructure/cloudflare-cdn-invalidation.adapter.js";
import { CdnInvalidationError } from "../../apps/worker/src/media-effects/application/ports.js";

describe("CloudflareCdnInvalidationAdapter", () => {
  it("requires a persisted managed hostname and deduplicates prefixes", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    const adapter = new CloudflareCdnInvalidationAdapter(
      "zone-id",
      "token",
      fetcher,
      async (hostname) => hostname === "manga.nodeprox.org",
    );
    await adapter.purgeUrls([
      "https://manga.nodeprox.org/a.webp?x=1",
      "https://manga.nodeprox.org/a.webp?x=2",
    ]);
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
      prefixes: ["manga.nodeprox.org/a.webp"],
    });
    await expect(
      adapter.purgeUrls(["https://foreign.nodeprox.org/a.webp"]),
    ).rejects.toMatchObject({ code: "cdn-invalid-url" });
    await expect(adapter.purgeUrls(["not-a-url"])).rejects.toMatchObject({
      code: "cdn-invalid-url",
      retryable: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("purges the exact media host/path prefix without query", async () => {
    const fetcher = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, { status: 200 }),
    );
    await new CloudflareCdnInvalidationAdapter(
      "zone-id",
      "secret-token",
      fetcher,
    ).purgeUrls(["https://media.nodeprox.org/raven/1/00.jpg?x=1"]);

    const [, init] = fetcher.mock.calls[0] ?? [];
    expect(JSON.parse(String(init?.body))).toEqual({
      prefixes: ["media.nodeprox.org/raven/1/00.jpg"],
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
      adapter.purgeUrls(["https://media.nodeprox.org/raven/1/00.jpg"]),
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
      await adapter.purgeUrls(["https://media.nodeprox.org/raven/1/00.jpg"]);
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
