import { EventEmitter } from "node:events";
import { Events } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { startBot } from "./bootstrap.js";
import type { DiscordBotConfig } from "./config/env.js";
import {
  bindClientLifecycle,
  registerShutdownHandlers,
} from "./discord/lifecycle.js";
import { BotHealthState } from "./health/health.js";

describe("Discord bot lifecycle", () => {
  it("marks ready after ClientReady and destroys the client on shutdown", async () => {
    const client = new EventEmitter() as EventEmitter & {
      destroy: ReturnType<typeof vi.fn>;
    };
    client.destroy = vi.fn();
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };
    const health = new BotHealthState();
    const stop = bindClientLifecycle({
      client: client as never,
      health,
      logger: logger as never,
    });
    client.emit(Events.ClientReady);
    expect(health.snapshot()).toEqual({
      status: "ready",
      discordConnected: true,
    });
    await stop("SIGTERM");
    expect(client.destroy).toHaveBeenCalledOnce();
    expect(health.snapshot().status).toBe("stopping");
  });

  it.each(["SIGINT", "SIGTERM"])(
    "destroys the client on %s",
    async (signal) => {
      const client = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      client.destroy = vi.fn();
      const logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
      };
      const stop = bindClientLifecycle({
        client: client as never,
        health: new BotHealthState(),
        logger: logger as never,
      });
      const handlers = new Map<string, () => void>();
      const once = vi.spyOn(process, "once").mockImplementation(((
        event: string,
        handler: () => void,
      ) => {
        handlers.set(event, handler);
        return process;
      }) as never);

      registerShutdownHandlers(stop);
      handlers.get(signal)?.();
      await vi.waitFor(() => expect(client.destroy).toHaveBeenCalledOnce());
      once.mockRestore();
    },
  );

  it.each([10062, 40060])(
    "keeps gateway health ready for interaction lifecycle error %s",
    (code) => {
      const client = new EventEmitter() as EventEmitter & {
        destroy: ReturnType<typeof vi.fn>;
      };
      client.destroy = vi.fn();
      const logger = {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        flush: vi.fn().mockResolvedValue(undefined),
      };
      const health = new BotHealthState();
      bindClientLifecycle({
        client: client as never,
        health,
        logger: logger as never,
      });
      client.emit(Events.ClientReady);
      client.emit(Events.Error, { code });
      expect(health.snapshot()).toEqual({
        status: "ready",
        discordConnected: true,
      });
      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.error).not.toHaveBeenCalled();
    },
  );
});

describe("Discord bot startup", () => {
  const config: DiscordBotConfig = {
    DISCORD_APPLICATION_ID: "application-id",
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_GUILD_ID: "guild-id",
    DISCORD_CONTROL_CHANNEL_ID: "channel-id",
    NODEPROX_INTERNAL_API_URL: "http://127.0.0.1:3001",
    DISCORD_BOT_INTERNAL_TOKEN: "internal-token",
    DISCORD_BOT_INTERNAL_HOST: "127.0.0.1",
    DISCORD_BOT_INTERNAL_PORT: 0,
    LOG_LEVEL: "silent",
  };

  it("validates integration, registers commands, and starts the gateway", async () => {
    const client = new EventEmitter() as EventEmitter & {
      destroy: ReturnType<typeof vi.fn>;
      login: ReturnType<typeof vi.fn>;
    };
    client.destroy = vi.fn();
    client.login = vi.fn().mockResolvedValue("bot-token");
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };
    const getIntegration = vi.fn().mockResolvedValue({
      enabled: true,
      guildId: config.DISCORD_GUILD_ID,
      controlChannelId: config.DISCORD_CONTROL_CHANNEL_ID,
    });
    const registerCommands = vi.fn().mockResolvedValue(undefined);

    await startBot({
      config,
      logger: logger as never,
      api: {
        getIntegration,
        confirmLink: vi.fn(),
        issueSeriesCreationGrant: vi.fn(),
      },
      client: client as never,
      registerCommands,
      installSignalHandlers: false,
    });

    expect(getIntegration).toHaveBeenCalledOnce();
    expect(registerCommands).toHaveBeenCalledOnce();
    expect(client.login).toHaveBeenCalledWith(config.DISCORD_BOT_TOKEN);
    expect(logger.info).toHaveBeenCalledWith("discord_bot.gateway.login.start");
  });

  it("rejects startup when gateway login fails", async () => {
    const client = new EventEmitter() as EventEmitter & {
      destroy: ReturnType<typeof vi.fn>;
      login: ReturnType<typeof vi.fn>;
    };
    client.destroy = vi.fn();
    client.login = vi.fn().mockRejectedValue(new Error("login rejected"));
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      flush: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      startBot({
        config,
        logger: logger as never,
        api: {
          getIntegration: vi.fn().mockResolvedValue({
            enabled: true,
            guildId: config.DISCORD_GUILD_ID,
            controlChannelId: config.DISCORD_CONTROL_CHANNEL_ID,
          }),
          confirmLink: vi.fn(),
          issueSeriesCreationGrant: vi.fn(),
        },
        client: client as never,
        registerCommands: vi.fn().mockResolvedValue(undefined),
        installSignalHandlers: false,
      }),
    ).rejects.toThrow("login rejected");

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        health: { status: "degraded", discordConnected: false },
      }),
      "discord_bot.startup.failed",
    );
  });
});
