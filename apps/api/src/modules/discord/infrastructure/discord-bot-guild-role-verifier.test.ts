import { describe, expect, it, vi } from "vitest";
import { DiscordGuildRoleVerificationUnavailableError } from "../application/discord-guild-role-verifier.js";
import { DiscordBotGuildRoleVerifier } from "./discord-bot-guild-role-verifier.js";

const guildId = "12345678901234567";
const roleId = "22345678901234567";

describe("DiscordBotGuildRoleVerifier", () => {
  it("uses the scoped bot M2M endpoint and accepts only a complete matching result", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          guildId,
          roles: [{ roleId, exists: true, name: "Issuer", position: 3 }],
        }),
        { status: 200 },
      ),
    );
    const verifier = new DiscordBotGuildRoleVerifier(
      "http://127.0.0.1:3002",
      "internal-token",
      fetcher,
    );
    await expect(
      verifier.verifyRoles({ guildId, roleIds: [roleId] }),
    ).resolves.toEqual({
      guildId,
      roles: [{ roleId, exists: true, name: "Issuer", position: 3 }],
    });
    expect(fetcher).toHaveBeenCalledWith(
      new URL("/internal/discord/guild-roles/verify", "http://127.0.0.1:3002"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fails closed for transport and malformed verifier responses", async () => {
    const unavailable = new DiscordBotGuildRoleVerifier(
      "http://127.0.0.1:3002",
      "internal-token",
      vi.fn().mockRejectedValue(new Error("offline")),
    );
    await expect(
      unavailable.verifyRoles({ guildId, roleIds: [roleId] }),
    ).rejects.toBeInstanceOf(DiscordGuildRoleVerificationUnavailableError);

    const malformed = new DiscordBotGuildRoleVerifier(
      "http://127.0.0.1:3002",
      "internal-token",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ guildId, roles: [] })),
        ),
    );
    await expect(
      malformed.verifyRoles({ guildId, roleIds: [roleId] }),
    ).rejects.toBeInstanceOf(DiscordGuildRoleVerificationUnavailableError);
  });
});
