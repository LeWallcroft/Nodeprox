import type {
  ChatInputCommandInteraction,
  Client,
  Interaction,
} from "discord.js";
import type { Logger } from "pino";
import { CommandUserError } from "./commands/command-user-error.js";
import { isAllowedControlChannel } from "./guards/control-channel.guard.js";
import { isAllowedGuild } from "./guards/guild.guard.js";

export interface DiscordCommandHandler {
  readonly name: string;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

async function safeReply(interaction: Interaction, content: string) {
  if (!interaction.isChatInputCommand()) return;
  const reply = { content, ephemeral: true };
  if (interaction.replied || interaction.deferred)
    await interaction.followUp(reply);
  else await interaction.reply(reply);
}

export function registerInteractionRouter(input: {
  client: Client;
  guildId: string;
  controlChannelId: string;
  handlers: readonly DiscordCommandHandler[];
  logger: Logger;
}) {
  const handlers = new Map(
    input.handlers.map((handler) => [handler.name, handler]),
  );
  input.client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const handler = handlers.get(interaction.commandName);
    if (!handler) return;
    if (!isAllowedGuild(interaction, input.guildId)) {
      await safeReply(
        interaction,
        "Este comando solo puede utilizarse en el servidor autorizado de NodeProx.",
      );
      return;
    }
    if (!isAllowedControlChannel(interaction, input.controlChannelId)) {
      await safeReply(
        interaction,
        "Este comando solo puede utilizarse en el canal autorizado de NodeProx.",
      );
      return;
    }
    const startedAt = Date.now();
    try {
      await handler.execute(interaction);
      input.logger.info(
        {
          command: handler.name,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          discordUserId: interaction.user.id,
          status: "success",
          durationMs: Date.now() - startedAt,
        },
        "Discord command handled",
      );
    } catch (error) {
      const source = error instanceof CommandUserError ? error.cause : error;
      input.logger.error(
        {
          err: source,
          command: handler.name,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          discordUserId: interaction.user.id,
          status: "failed",
          durationMs: Date.now() - startedAt,
        },
        "Discord command failed",
      );
      await safeReply(
        interaction,
        error instanceof CommandUserError
          ? error.userMessage
          : "No se pudo completar la solicitud. Inténtalo nuevamente más tarde.",
      );
    }
  });
}
