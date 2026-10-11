import { ChannelType } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import {
  createDiscordInternalServer,
  notificationNonce,
} from "./discord-internal.server.js";

const guildId = "12345678901234567";
const controlChannelId = "12345678901234568";
const existingRoleId = "22345678901234567";
const missingRoleId = "32345678901234567";

function setup() {
  const roles = new Map([[existingRoleId, { name: "Issuer", position: 3 }]]);
  const client = {
    guilds: {
      cache: new Map([
        [guildId, { roles: { fetch: vi.fn().mockResolvedValue(roles) } }],
      ]),
    },
  } as never;
  const server = createDiscordInternalServer({
    client,
    expectedToken: "internal-token",
    guildId,
    controlChannelId,
    logger: { info: vi.fn(), warn: vi.fn() } as never,
  });
  return { server };
}

describe("guild role verifier internal endpoint", () => {
  it("creates a stable bounded nonce for a domain event", () => {
    expect(notificationNonce("00000000-0000-4000-8000-000000000001")).toBe(
      notificationNonce("00000000-0000-4000-8000-000000000001"),
    );
    expect(
      notificationNonce("00000000-0000-4000-8000-000000000001"),
    ).toHaveLength(25);
  });

  it("serves the minimal Discord user profile through the authenticated internal API", async () => {
    const profileUser = {
      id: "12345678901234567",
      username: "reader",
      displayAvatarURL: vi
        .fn()
        .mockReturnValue(
          "https://cdn.discordapp.com/avatars/12345678901234567/hash.webp",
        ),
    };
    const client = {
      users: { fetch: vi.fn().mockResolvedValue(profileUser) },
      guilds: { cache: new Map() },
      channels: { fetch: vi.fn() },
      user: null,
    } as never;
    const server = createDiscordInternalServer({
      client,
      expectedToken: "internal-token",
      guildId,
      controlChannelId,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
    });
    const port = await server.start("127.0.0.1", 0);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/internal/discord/users/12345678901234567/profile`,
        {
          headers: { authorization: "Bearer internal-token" },
        },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        id: "12345678901234567",
        username: "reader",
        avatarUrl:
          "https://cdn.discordapp.com/avatars/12345678901234567/hash.webp",
      });
      expect(profileUser.displayAvatarURL).toHaveBeenCalledWith({
        extension: "webp",
        size: 128,
      });
    } finally {
      await server.stop();
    }
  });

  it("sends an idempotent embedded grant notification to the control channel", async () => {
    const send = vi.fn().mockResolvedValue({ id: "message-1" });
    const client = {
      guilds: { cache: new Map() },
      channels: { fetch: vi.fn().mockResolvedValue({ send }) },
      user: null,
    } as never;
    const server = createDiscordInternalServer({
      client,
      expectedToken: "internal-token",
      guildId,
      controlChannelId,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
    });
    const port = await server.start("127.0.0.1", 0);
    const sourceEventId = "00000000-0000-4000-8000-000000000001";
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/internal/discord/users/12345678901234567/notifications/series-grant`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer internal-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sourceEventId,
            reference: "case-1",
            webUrl: "https://nodeprox.example",
          }),
        },
      );
      await expect(response.json()).resolves.toEqual({
        status: "sent",
        messageId: "message-1",
      });
      expect(send).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "<@12345678901234567>",
          allowedMentions: { parse: [], users: ["12345678901234567"] },
          nonce: notificationNonce(sourceEventId),
          enforceNonce: true,
          components: expect.any(Array),
        }),
      );
      const payload = send.mock.calls[0]?.[0];
      expect(payload.embeds[0].data.title).toBe(
        "🎉 ¡Ya puedes crear una Serie!",
      );
      expect(payload.embeds[0].data.description).toContain(
        "Tu autorización ya está disponible en NodeProx.",
      );
      expect(payload.embeds[0].data.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "✨ Permiso disponible",
            value: "**Crear una Serie**",
          }),
          expect.objectContaining({ name: "🟢 Estado", value: "Disponible" }),
          expect.objectContaining({ name: "🏷️ Referencia", value: "case-1" }),
        ]),
      );
      expect(payload.embeds[0].data.url).toBe("https://nodeprox.example");
      expect(payload.components[0].components[0].data.url).toBe(
        "https://nodeprox.example",
      );
      expect(payload.components[0].components[0].data.label).toBe(
        "🔗 Abrir NodeProx",
      );
    } finally {
      await server.stop();
    }
  });

  it("accepts the canonical 500-character grant reference within embed limits", async () => {
    const send = vi.fn().mockResolvedValue({ id: "message-500" });
    const client = {
      guilds: { cache: new Map() },
      channels: { fetch: vi.fn().mockResolvedValue({ send }) },
      user: null,
    } as never;
    const server = createDiscordInternalServer({
      client,
      expectedToken: "internal-token",
      guildId,
      controlChannelId,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
    });
    const port = await server.start("127.0.0.1", 0);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/internal/discord/users/12345678901234567/notifications/series-grant`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer internal-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sourceEventId: "00000000-0000-4000-8000-000000000001",
            reference: "r".repeat(500),
            webUrl: "https://nodeprox.example",
          }),
        },
      );
      expect(response.status).toBe(200);
      expect(send).toHaveBeenCalledOnce();
      const embed = send.mock.calls[0]?.[0].embeds[0];
      expect(embed.data.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "🏷️ Referencia",
            value: "r".repeat(500),
          }),
        ]),
      );
      expect(embed.data.description.length).toBeLessThanOrEqual(4096);

      const tooLong = await fetch(
        `http://127.0.0.1:${port}/internal/discord/users/12345678901234567/notifications/series-grant`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer internal-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sourceEventId: "00000000-0000-4000-8000-000000000002",
            reference: "r".repeat(501),
            webUrl: "https://nodeprox.example",
          }),
        },
      );
      expect(tooLong.status).toBe(400);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      await server.stop();
    }
  });

  it("verifies only roles in the configured guild with M2M authentication", async () => {
    const { server } = setup();
    const port = await server.start("127.0.0.1", 0);
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/internal/discord/guild-roles/verify`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer internal-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            guildId,
            roleIds: [existingRoleId, missingRoleId],
          }),
        },
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        guildId,
        roles: [
          { roleId: existingRoleId, exists: true, name: "Issuer", position: 3 },
          { roleId: missingRoleId, exists: false },
        ],
      });
    } finally {
      await server.stop();
    }
  });

  it("rejects invalid M2M, arbitrary guilds, duplicate and invalid role IDs", async () => {
    const { server } = setup();
    const port = await server.start("127.0.0.1", 0);
    const request = (token: string, body: unknown) =>
      fetch(`http://127.0.0.1:${port}/internal/discord/guild-roles/verify`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
    try {
      await expect(
        request("wrong", { guildId, roleIds: [] }),
      ).resolves.toMatchObject({ status: 401 });
      await expect(
        request("internal-token", {
          guildId: "42345678901234567",
          roleIds: [],
        }),
      ).resolves.toMatchObject({ status: 403 });
      await expect(
        request("internal-token", {
          guildId,
          roleIds: [existingRoleId, existingRoleId],
        }),
      ).resolves.toMatchObject({ status: 400 });
      await expect(
        request("internal-token", { guildId, roleIds: ["invalid"] }),
      ).resolves.toMatchObject({ status: 400 });
    } finally {
      await server.stop();
    }
  });

  it("lists and validates only safe series channels through the M2M boundary", async () => {
    const textChannel = {
      id: existingRoleId,
      guildId,
      name: "series-manga",
      type: ChannelType.GuildText,
      permissionsFor: () => ({ has: () => true }),
    };
    const controlChannel = {
      ...textChannel,
      id: controlChannelId,
      name: "control",
    };
    const voiceChannel = {
      ...textChannel,
      id: missingRoleId,
      type: ChannelType.GuildVoice,
    };
    const client = {
      user: { id: "42345678901234567" },
      guilds: {
        cache: new Map([
          [
            guildId,
            {
              channels: {
                fetch: vi.fn().mockResolvedValue(
                  new Map([
                    [textChannel.id, textChannel],
                    [controlChannel.id, controlChannel],
                    [voiceChannel.id, voiceChannel],
                  ]),
                ),
              },
              roles: { fetch: vi.fn().mockResolvedValue(new Map()) },
            },
          ],
        ]),
      },
      channels: {
        fetch: vi.fn(async (id: string) =>
          id === textChannel.id
            ? textChannel
            : id === controlChannel.id
              ? controlChannel
              : null,
        ),
      },
    } as never;
    const server = createDiscordInternalServer({
      client,
      expectedToken: "internal-token",
      guildId,
      controlChannelId,
      logger: { info: vi.fn(), warn: vi.fn() } as never,
    });
    const port = await server.start("127.0.0.1", 0);
    try {
      const list = await fetch(
        `http://127.0.0.1:${port}/internal/discord/series-channels`,
        { headers: { authorization: "Bearer internal-token" } },
      );
      await expect(list.json()).resolves.toEqual({
        items: [{ id: textChannel.id, name: textChannel.name }],
      });

      const valid = await fetch(
        `http://127.0.0.1:${port}/internal/discord/series-channels/validate`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer internal-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ channelId: textChannel.id }),
        },
      );
      await expect(valid.json()).resolves.toEqual({
        valid: true,
        channel: { id: textChannel.id, name: textChannel.name },
      });

      const control = await fetch(
        `http://127.0.0.1:${port}/internal/discord/series-channels/validate`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer internal-token",
            "content-type": "application/json",
          },
          body: JSON.stringify({ channelId: controlChannel.id }),
        },
      );
      await expect(control.json()).resolves.toEqual({
        valid: false,
        reason: "control_channel",
      });
    } finally {
      await server.stop();
    }
  });
});
