import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDiscordLinkCode } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("Discord link-code API", () => {
  it("uses the authenticated same-origin link-code endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: "NPX-LINK-OPAQUE", expiresInSeconds: 600 }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateDiscordLinkCode()).resolves.toEqual({
      code: "NPX-LINK-OPAQUE",
      expiresInSeconds: 600,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/discord/link-code",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});
