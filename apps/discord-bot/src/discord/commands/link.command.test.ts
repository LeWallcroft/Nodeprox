import { MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { LinkDiscordAccount } from "../../application/link-discord-account.js";
import { NodeProxApiError } from "../../infrastructure/nodeprox-api/nodeprox-api.client.js";
import { LinkCommand } from "./link.command.js";

function interaction() {
  const target = {
    id: "interaction-1",
    guildId: "guild-1",
    channelId: "channel-1",
    user: { id: "discord-user-1" },
    options: { getString: vi.fn().mockReturnValue("NPX-LINK-code") },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferred: false,
    replied: false,
    deferReply: vi.fn().mockImplementation(async () => {
      target.deferred = true;
    }),
  };
  return target;
}

describe("/vincular", () => {
  it("uses identity exclusively from the Discord interaction and replies ephemerally", async () => {
    const api = {
      confirmLink: vi
        .fn()
        .mockResolvedValue({ linked: true, idempotent: false }),
      getIntegration: vi.fn(),
      issueSeriesCreationGrant: vi.fn(),
    };
    const command = new LinkCommand(new LinkDiscordAccount(api));
    const target = interaction();
    await command.execute(target as never);
    expect(api.confirmLink).toHaveBeenCalledWith({
      code: "NPX-LINK-code",
      discordId: "discord-user-1",
      actorDiscordId: "discord-user-1",
      guildId: "guild-1",
      channelId: "channel-1",
      interactionId: "interaction-1",
    });
    expect(target.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
    const response = target.editReply.mock.calls[0]?.[0];
    expect(response.embeds).toHaveLength(1);
    expect(response.embeds[0].data.title).toBe("✅ Cuenta vinculada");
  });

  it("maps an expired code to a safe user-facing error", async () => {
    const api = {
      confirmLink: vi
        .fn()
        .mockRejectedValue(
          new NodeProxApiError("discord-link-code-invalid", 400),
        ),
      getIntegration: vi.fn(),
      issueSeriesCreationGrant: vi.fn(),
    };
    const command = new LinkCommand(new LinkDiscordAccount(api));
    await expect(command.execute(interaction() as never)).rejects.toMatchObject(
      {
        userMessage: "El código no es válido o ya expiró.",
      },
    );
  });

  it("treats an idempotent confirmation as the same safe success", async () => {
    const api = {
      confirmLink: vi
        .fn()
        .mockResolvedValue({ linked: true, idempotent: true }),
      getIntegration: vi.fn(),
      issueSeriesCreationGrant: vi.fn(),
    };
    const command = new LinkCommand(new LinkDiscordAccount(api));
    const target = interaction();
    await command.execute(target as never);
    expect(target.editReply.mock.calls[0]?.[0].embeds[0].data.title).toBe(
      "✅ Cuenta vinculada",
    );
  });

  it("maps an already linked NodeProx account without exposing internals", async () => {
    const api = {
      confirmLink: vi
        .fn()
        .mockRejectedValue(
          new NodeProxApiError("discord-link-already-exists", 409),
        ),
      getIntegration: vi.fn(),
      issueSeriesCreationGrant: vi.fn(),
    };
    const command = new LinkCommand(new LinkDiscordAccount(api));
    await expect(command.execute(interaction() as never)).rejects.toMatchObject(
      {
        userMessage:
          "Tu cuenta de NodeProx ya tiene una cuenta de Discord vinculada.",
      },
    );
  });

  it("does not expose API failures", async () => {
    const api = {
      confirmLink: vi.fn().mockRejectedValue(new NodeProxApiError(null, 0)),
      getIntegration: vi.fn(),
      issueSeriesCreationGrant: vi.fn(),
    };
    const command = new LinkCommand(new LinkDiscordAccount(api));
    await expect(command.execute(interaction() as never)).rejects.toMatchObject(
      {
        userMessage:
          "No se pudo completar la vinculación. Inténtalo nuevamente más tarde.",
      },
    );
  });
});
