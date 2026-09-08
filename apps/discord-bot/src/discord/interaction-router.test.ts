import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerInteractionRouter } from "./interaction-router.js";

describe("interaction router", () => {
  it("contains handler exceptions and sends one safe ephemeral response", async () => {
    const client = new EventEmitter();
    const reply = vi.fn().mockResolvedValue(undefined);
    const logger = { info: vi.fn(), error: vi.fn() };
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
      ephemeral: true,
    });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
