import { afterEach, describe, expect, it, vi } from "vitest";
import { generateDiscordLinkCode, getDiscordLinkStatus } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("Discord link-code API", () => {
  it("uses the authenticated same-origin link-code endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "NPX-LINK-OPAQUE",
          expiresAt: "2030-01-01T00:10:00.000Z",
          expiresInSeconds: 600,
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateDiscordLinkCode()).resolves.toEqual({
      code: "NPX-LINK-OPAQUE",
      expiresAt: "2030-01-01T00:10:00.000Z",
      expiresInSeconds: 600,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/discord/link-code",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});

describe("Discord link status API", () => {
  it("uses the authenticated status endpoint without accepting identity input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          state: "pending",
          expiresAt: "2030-01-01T00:10:00.000Z",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getDiscordLinkStatus()).resolves.toEqual({
      state: "pending",
      expiresAt: "2030-01-01T00:10:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/me/discord-link",
      expect.objectContaining({ credentials: "include" }),
    );
  });
});
