import { describe, expect, it, vi } from "vitest";
import { NodeProxApiClient, NodeProxApiError } from "./nodeprox-api.client.js";

describe("NodeProxApiClient", () => {
  it("signals only the Discord ID with an empty authenticated body", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ accepted: true }), { status: 200 }),
      );
    const client = new NodeProxApiClient(
      "https://api.example.test",
      "internal-token",
      fetcher,
    );
    await expect(
      client.notifyProfileChanged({ discordId: "12345678901234567" }),
    ).resolves.toEqual({ accepted: true });
    expect(fetcher).toHaveBeenCalledWith(
      new URL(
        "/internal/discord/users/12345678901234567/profile-changed",
        "https://api.example.test",
      ),
      expect.objectContaining({
        method: "POST",
        body: "{}",
        headers: expect.objectContaining({
          authorization: "Bearer internal-token",
        }),
      }),
    );
  });
  it("sends only the M2M contract and bounded request", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ linked: true, idempotent: false }), {
        status: 200,
      }),
    );
    const client = new NodeProxApiClient(
      "https://api.example.test",
      "internal-token",
      fetcher,
    );
    await client.confirmLink({
      code: "code",
      discordId: "discord-user",
      discordUsername: "discord-user",
      discordAvatarUrl: null,
      actorDiscordId: "discord-user",
      guildId: "guild",
      channelId: "channel",
      interactionId: "interaction",
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("/internal/discord/confirm-link", "https://api.example.test"),
      expect.objectContaining({
        headers: {
          authorization: "Bearer internal-token",
          "content-type": "application/json",
        },
      }),
    );
  });

  it("maps API error codes without automatic mutation retries", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "discord-link-code-invalid" }), {
        status: 400,
      }),
    );
    const client = new NodeProxApiClient(
      "https://api.example.test",
      "internal-token",
      fetcher,
    );
    await expect(
      client.confirmLink({
        code: "code",
        discordId: "user",
        discordUsername: "user",
        discordAvatarUrl: null,
        actorDiscordId: "user",
        guildId: "guild",
        channelId: "channel",
        interactionId: "interaction",
      }),
    ).rejects.toEqual(new NodeProxApiError("discord-link-code-invalid", 400));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("prefers the Problem Details request ID and never exposes provider detail", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "discord-link-code-invalid",
          requestId: "body-request",
          category: "validation",
          detail: "secret provider detail",
        }),
        { status: 400, headers: { "x-request-id": "header-request" } },
      ),
    );
    const client = new NodeProxApiClient(
      "https://api.example.test",
      "token",
      fetcher,
    );
    await expect(client.getIntegration()).rejects.toMatchObject({
      code: "discord-link-code-invalid",
      requestId: "body-request",
      category: "validation",
      status: 400,
    });
    await expect(client.getIntegration()).rejects.not.toThrow(
      "secret provider detail",
    );
  });
  it("falls back to the response request ID header", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "unavailable" }), {
        status: 503,
        headers: { "x-request-id": "header-request" },
      }),
    );
    const client = new NodeProxApiClient(
      "https://api.example.test",
      "token",
      fetcher,
    );
    await expect(client.getIntegration()).rejects.toMatchObject({
      requestId: "header-request",
    });
  });

  it("issues grants only through the internal M2M endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "grant",
          displayCode: "NPX-SER-OPAQUE",
          reference: null,
          status: "available",
          issuedAt: "2026-09-08T00:00:00.000Z",
          targetUser: { id: "user", username: "user" },
        }),
        { status: 201 },
      ),
    );
    const client = new NodeProxApiClient(
      "https://api.example.test",
      "internal-token",
      fetcher,
    );
    await client.issueSeriesCreationGrant({
      targetDiscordId: "target-discord",
      actorDiscordId: "actor-discord",
      actorRoleIds: ["issuer"],
      guildId: "guild",
      channelId: "channel",
      interactionId: "interaction",
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("/internal/discord/series-grants", "https://api.example.test"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses the dedicated M2M configuration endpoints", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            guildId: "guild",
            controlChannelId: "channel",
            enabled: true,
            authorizedRoles: [],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            guildId: "guild",
            authorizedRoles: [],
            updatedAt: "2026-09-10T00:00:00.000Z",
          }),
          { status: 200 },
        ),
      );
    const client = new NodeProxApiClient(
      "https://api.example.test",
      "internal-token",
      fetcher,
    );
    await client.getDiscordConfiguration();
    await client.replaceAuthorizedRoles({
      actorDiscordId: "actor",
      actorRoleIds: ["role"],
      guildId: "guild",
      channelId: "channel",
      interactionId: "interaction",
      roles: [{ roleId: "12345678901234567", capabilities: ["bot.configure"] }],
    });
    expect(fetcher.mock.calls[0]?.[0]).toEqual(
      new URL("/internal/discord/configuration", "https://api.example.test"),
    );
    expect(fetcher.mock.calls[1]?.[0]).toEqual(
      new URL("/internal/discord/authorized-roles", "https://api.example.test"),
    );
    expect(fetcher.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
