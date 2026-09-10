import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Client,
  Interaction,
  ModalSubmitInteraction,
  RepliableInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import type { Logger } from "pino";
import { CommandUserError } from "./commands/command-user-error.js";
import { DiscordInteractionError } from "./commands/discord-interaction-error.js";
import { isAllowedControlChannel } from "./guards/control-channel.guard.js";
import { isAllowedGuild } from "./guards/guild.guard.js";
import {
  ephemeralPayload,
  interactionErrorCode,
  isInteractionLifecycleError,
  respondSafely,
} from "./interaction-response.js";

export interface DiscordCommandHandler {
  readonly name: string;
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface DiscordComponentHandler {
  readonly customIdPrefix: string;
  executeComponent(
    interaction:
      | ButtonInteraction
      | UserSelectMenuInteraction
      | ModalSubmitInteraction,
  ): Promise<void>;
}

async function safeReply(interaction: Interaction, content: string) {
  if (!("reply" in interaction) || typeof interaction.reply !== "function")
    return;
  await respondSafely(
    interaction as RepliableInteraction,
    ephemeralPayload({ content }),
  );
}

export function registerInteractionRouter(input: {
  client: Client;
  guildId: string;
  controlChannelId: string;
  handlers: readonly DiscordCommandHandler[];
  componentHandlers?: readonly DiscordComponentHandler[];
  logger: Logger;
}) {
  const handlers = new Map(
    input.handlers.map((handler) => [handler.name, handler]),
  );
  const componentHandlers = input.componentHandlers ?? [];
  input.client.on("interactionCreate", async (interaction) => {
    const isChatInputCommand = interaction.isChatInputCommand();
    const isButton = interaction.isButton?.() ?? false;
    const isUserSelectMenu = interaction.isUserSelectMenu?.() ?? false;
    const isModalSubmit = interaction.isModalSubmit?.() ?? false;
    const customId =
      "customId" in interaction && typeof interaction.customId === "string"
        ? interaction.customId
        : undefined;
    const handler = isChatInputCommand
      ? handlers.get(interaction.commandName)
      : isButton || isUserSelectMenu || isModalSubmit
        ? componentHandlers.find((candidate) =>
            customId?.startsWith(candidate.customIdPrefix),
          )
        : undefined;
    if (!handler) return;
    const handlerName =
      "name" in handler ? handler.name : handler.customIdPrefix;
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
      if (isChatInputCommand)
        await (handler as DiscordCommandHandler).execute(interaction as never);
      else
        await (handler as DiscordComponentHandler).executeComponent(
          interaction as never,
        );
      input.logger.info(
        {
          command: handlerName,
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
      const typedError =
        error instanceof CommandUserError ||
        error instanceof DiscordInteractionError
          ? error
          : undefined;
      const source = typedError?.cause ?? error;
      if (isInteractionLifecycleError(source)) {
        input.logger.warn(
          {
            command: handlerName,
            interactionId: interaction.id,
            code: interactionErrorCode(source),
            status: "interaction-lifecycle-error",
          },
          "Discord interaction lifecycle error",
        );
        return;
      }
      input.logger.error(
        {
          err: source,
          errorName: error instanceof Error ? error.name : typeof error,
          errorCode:
            error instanceof DiscordInteractionError
              ? error.failure
              : undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
          command: handlerName,
          interactionId: interaction.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          discordUserId: interaction.user.id,
          status: "failed",
          durationMs: Date.now() - startedAt,
        },
        "Discord command failed",
      );
      const genericMessage =
        handlerName === "autorizar-serie"
          ? "No se pudo iniciar la autorización. Inténtalo nuevamente."
          : "No se pudo completar la solicitud. Inténtalo nuevamente más tarde.";
      await safeReply(
        interaction,
        error instanceof CommandUserError ||
          error instanceof DiscordInteractionError
          ? error.userMessage
          : genericMessage,
      );
    }
  });
}
