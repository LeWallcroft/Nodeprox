import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequestBrowser } from "./browser";

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
});
