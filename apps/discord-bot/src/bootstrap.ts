import type { Client } from "discord.js";
import type { Logger } from "pino";
import { LinkDiscordAccount } from "./application/link-discord-account.js";
import { type DiscordBotConfig, loadDiscordBotConfig } from "./config/env.js";
import { createDiscordClient } from "./discord/client.js";
import { AuthorizeSeriesWorkflow } from "./discord/commands/authorize-series.workflow.js";
import { HelpCommand } from "./discord/commands/help.command.js";
import { LinkCommand } from "./discord/commands/link.command.js";
import { registerInteractionRouter } from "./discord/interaction-router.js";
import {
  bindClientLifecycle,
  registerShutdownHandlers,
} from "./discord/lifecycle.js";
import { registerGuildCommands } from "./discord/register-commands.js";
import { BotHealthState } from "./health/health.js";
import type { NodeProxDiscordApi } from "./infrastructure/nodeprox-api/contracts.js";
import { NodeProxApiClient } from "./infrastructure/nodeprox-api/nodeprox-api.client.js";
import { createGuildRoleVerifierServer } from "./internal/guild-role-verifier.server.js";
import { createBotLogger } from "./observability/logger.js";

type RegisterCommands = typeof registerGuildCommands;

export type StartBotDependencies = {
  config?: DiscordBotConfig;
  logger?: Logger;
  api?: NodeProxDiscordApi;
  client?: Client;
  registerCommands?: RegisterCommands;
  installSignalHandlers?: boolean;
};

export async function startBot(dependencies: StartBotDependencies = {}) {
  const config = dependencies.config ?? loadDiscordBotConfig();
  const logger = dependencies.logger ?? createBotLogger(config.LOG_LEVEL);
  const health = new BotHealthState();

  try {
    logger.info("discord_bot.bootstrap.start");
    const api =
      dependencies.api ??
      new NodeProxApiClient(
        config.NODEPROX_INTERNAL_API_URL,
        config.DISCORD_BOT_INTERNAL_TOKEN,
      );
    const integration = await api.getIntegration();
    if (
      !integration.enabled ||
      integration.guildId !== config.DISCORD_GUILD_ID ||
      integration.controlChannelId !== config.DISCORD_CONTROL_CHANNEL_ID
    )
      throw new Error("Discord bot integration configuration does not match.");
    logger.info("discord_bot.integration.validated");

    const client = dependencies.client ?? createDiscordClient();
    const stop = bindClientLifecycle({
      client,
      health,
      logger,
    });
    if (dependencies.installSignalHandlers ?? true)
      registerShutdownHandlers(stop);

    const authorizeSeries = new AuthorizeSeriesWorkflow(api);
    registerInteractionRouter({
      client,
      guildId: config.DISCORD_GUILD_ID,
      controlChannelId: config.DISCORD_CONTROL_CHANNEL_ID,
      handlers: [
        new LinkCommand(new LinkDiscordAccount(api)),
        authorizeSeries,
        new HelpCommand(),
      ],
      componentHandlers: [authorizeSeries],
      logger,
    });
    await (dependencies.registerCommands ?? registerGuildCommands)({
      applicationId: config.DISCORD_APPLICATION_ID,
      guildId: config.DISCORD_GUILD_ID,
      botToken: config.DISCORD_BOT_TOKEN,
    });
    logger.info("discord_bot.commands.registered");
    logger.info("discord_bot.gateway.login.start");
    await client.login(config.DISCORD_BOT_TOKEN);
    const verifier = createGuildRoleVerifierServer({
      client,
      expectedToken: config.DISCORD_BOT_INTERNAL_TOKEN,
      guildId: config.DISCORD_GUILD_ID,
      logger,
    });
    await verifier.start(
      config.DISCORD_BOT_INTERNAL_HOST,
      config.DISCORD_BOT_INTERNAL_PORT,
    );
    return {
      client,
      health,
      stop: async (signal: string) => {
        await verifier.stop();
        await stop(signal);
      },
    };
  } catch (error) {
    health.markDegraded();
    logger.error(
      { err: error, health: health.snapshot() },
      "discord_bot.startup.failed",
    );
    throw error;
  }
}
