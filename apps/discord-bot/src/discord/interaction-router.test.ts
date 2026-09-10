import { EventEmitter } from "node:events";
import { MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { DiscordInteractionError } from "./commands/discord-interaction-error.js";
import { registerInteractionRouter } from "./interaction-router.js";

describe("interaction router", () => {
  it("contains handler exceptions and sends one safe ephemeral response", async () => {
    const client = new EventEmitter();
    const reply = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    registerInteractionRouter({
      client: client as never,
      guildId: "guild",
      controlChannelId: "channel",
      handlers: [
        {
          name: "vincular",
          execute: vi.fn().mockRejectedValue(new Error("internal")),
        },
      ],
      logger: logger as never,
    });
    client.emit("interactionCreate", {
      isChatInputCommand: () => true,
      commandName: "vincular",
      guildId: "guild",
      channelId: "channel",
      id: "interaction",
      user: { id: "user" },
      replied: false,
      deferred: false,
      reply,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(reply).toHaveBeenCalledWith({
      content:
        "No se pudo completar la solicitud. Inténtalo nuevamente más tarde.",
      flags: MessageFlags.Ephemeral,
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("maps an unknown authorization failure to the safe internal copy, not stale", async () => {
    const client = new EventEmitter();
    const reply = vi.fn().mockResolvedValue(undefined);
    registerInteractionRouter({
      client: client as never,
      guildId: "guild",
      controlChannelId: "channel",
      handlers: [
        {
          name: "autorizar-serie",
          execute: vi.fn().mockRejectedValue(new Error("internal")),
        },
      ],
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
    });
    client.emit("interactionCreate", {
      isChatInputCommand: () => true,
      commandName: "autorizar-serie",
      guildId: "guild",
      channelId: "channel",
      id: "interaction",
      user: { id: "user" },
      replied: false,
      deferred: false,
      reply,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(reply).toHaveBeenCalledWith({
      content: "No se pudo iniciar la autorización. Inténtalo nuevamente.",
      flags: MessageFlags.Ephemeral,
    });
  });

  it("routes only known workflow component IDs through the same guards", async () => {
    const client = new EventEmitter();
    const executeComponent = vi.fn().mockResolvedValue(undefined);
    registerInteractionRouter({
      client: client as never,
      guildId: "guild",
      controlChannelId: "channel",
      handlers: [],
      componentHandlers: [
        { customIdPrefix: "nodeprox:series-grant:", executeComponent },
      ],
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
    });
    const interaction = {
      isChatInputCommand: () => false,
      isButton: () => true,
      isUserSelectMenu: () => false,
      isModalSubmit: () => false,
      customId: "nodeprox:series-grant:confirm:workflow",
      guildId: "guild",
      channelId: "channel",
      id: "interaction",
      user: { id: "user" },
    };
    client.emit("interactionCreate", interaction);
    await new Promise((resolve) => setImmediate(resolve));
    expect(executeComponent).toHaveBeenCalledWith(interaction);
  });

  it("uses execute for a chat command even when its workflow also handles components", async () => {
    const client = new EventEmitter();
    const execute = vi.fn().mockResolvedValue(undefined);
    const executeComponent = vi.fn().mockResolvedValue(undefined);
    const workflowHandler = {
      name: "autorizar-serie",
      customIdPrefix: "nodeprox:series-grant:",
      execute,
      executeComponent,
    };
    registerInteractionRouter({
      client: client as never,
      guildId: "guild",
      controlChannelId: "channel",
      handlers: [workflowHandler],
      componentHandlers: [workflowHandler],
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
    });
    const interaction = {
      isChatInputCommand: () => true,
      commandName: "autorizar-serie",
      guildId: "guild",
      channelId: "channel",
      id: "interaction",
      user: { id: "user" },
    };
    client.emit("interactionCreate", interaction);
    await new Promise((resolve) => setImmediate(resolve));
    expect(execute).toHaveBeenCalledWith(interaction);
    expect(executeComponent).not.toHaveBeenCalled();
  });

  it.each([10062, 40060])(
    "contains lifecycle error %s without sending another ACK",
    async (code) => {
      const client = new EventEmitter();
      const reply = vi.fn().mockResolvedValue(undefined);
      const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
      registerInteractionRouter({
        client: client as never,
        guildId: "guild",
        controlChannelId: "channel",
        handlers: [
          {
            name: "ayuda",
            execute: vi.fn().mockRejectedValue({ code }),
          },
        ],
        logger: logger as never,
      });
      client.emit("interactionCreate", {
        isChatInputCommand: () => true,
        commandName: "ayuda",
        guildId: "guild",
        channelId: "channel",
        id: "interaction",
        user: { id: "user" },
        replied: false,
        deferred: false,
        reply,
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(reply).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it("maps unauthorized failures after a deferred command without a second ACK", async () => {
    const client = new EventEmitter();
    const editReply = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
    registerInteractionRouter({
      client: client as never,
      guildId: "guild",
      controlChannelId: "channel",
      handlers: [
        {
          name: "autorizar-serie",
          execute: vi
            .fn()
            .mockRejectedValue(new DiscordInteractionError("unauthorized")),
        },
      ],
      logger: logger as never,
    });
    const interaction = {
      isChatInputCommand: () => true,
      commandName: "autorizar-serie",
      guildId: "guild",
      channelId: "channel",
      id: "interaction",
      user: { id: "user" },
      replied: false,
      deferred: true,
      reply: vi.fn(),
      editReply,
    };
    client.emit("interactionCreate", interaction);
    await new Promise((resolve) => setImmediate(resolve));
    expect(editReply).toHaveBeenCalledWith({
      content: "No tienes permisos para autorizar la creación de Series.",
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it("keeps the control-channel rejection specific", async () => {
    const client = new EventEmitter();
    const reply = vi.fn().mockResolvedValue(undefined);
    registerInteractionRouter({
      client: client as never,
      guildId: "guild",
      controlChannelId: "control",
      handlers: [{ name: "autorizar-serie", execute: vi.fn() }],
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } as never,
    });
    client.emit("interactionCreate", {
      isChatInputCommand: () => true,
      commandName: "autorizar-serie",
      guildId: "guild",
      channelId: "wrong-channel",
      id: "interaction",
      user: { id: "user" },
      replied: false,
      deferred: false,
      reply,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(reply).toHaveBeenCalledWith({
      content:
        "Este comando solo puede utilizarse en el canal autorizado de NodeProx.",
      flags: MessageFlags.Ephemeral,
    });
  });
});
