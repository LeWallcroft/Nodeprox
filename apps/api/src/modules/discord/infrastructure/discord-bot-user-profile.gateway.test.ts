import { describe, expect, it, vi } from "vitest";
import { DiscordBotUserProfileGateway } from "./discord-bot-user-profile.gateway.js";
import { DiscordUserProfileUnavailableError } from "../application/discord-user-profile.gateway.js";

describe("DiscordBotUserProfileGateway", () => {
  it("accepts only the exact safe response and trusted Discord avatar", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "12345678901234567",
          username: "reader",
          avatarUrl:
            "https://cdn.discordapp.com/avatars/12345678901234567/hash.webp",
        }),
        { status: 200 },
      ),
    );
    const gateway = new DiscordBotUserProfileGateway(
      "http://discord-bot:3002",
      "token",
      fetcher,
    );
    await expect(
      gateway.getProfile("12345678901234567"),
    ).resolves.toMatchObject({ username: "reader" });
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("maps not-found to null and rejects untrusted/extra fields", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "12345678901234567",
            username: "reader",
            avatarUrl: "https://evil.test/a.webp",
          }),
          { status: 200 },
        ),
      );
    const gateway = new DiscordBotUserProfileGateway(
      "http://discord-bot:3002",
      "token",
      fetcher,
    );
    await expect(gateway.getProfile("12345678901234567")).resolves.toBeNull();
    await expect(
      gateway.getProfile("12345678901234567"),
    ).rejects.toBeInstanceOf(DiscordUserProfileUnavailableError);
  });
});
