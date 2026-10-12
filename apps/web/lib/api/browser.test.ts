import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequestBrowser } from "./browser";
import { ApiUnavailableError } from "./types";

describe("apiRequestBrowser cache policy", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("forces authenticated requests to bypass browser HTTP cache", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequestBrowser("/me/upload-operations", { cache: "force-cache" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/upload-operations",
      expect.objectContaining({ cache: "no-store", credentials: "include" }),
    );
  });
  it("normalizes a network failure without exposing transport details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("private endpoint")),
    );
    await expect(apiRequestBrowser("/auth/session")).rejects.toBeInstanceOf(
      ApiUnavailableError,
    );
  });
  it("preserves intentional cancellation", async () => {
    const controller = new AbortController();
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    controller.abort();
    await expect(
      apiRequestBrowser("/auth/session", { signal: controller.signal }),
    ).rejects.toBe(abort);
  });
});
