import type { ChatInputCommandInteraction } from "discord.js";
import type { LinkDiscordAccount } from "../../application/link-discord-account.js";
import { NodeProxApiError } from "../../infrastructure/nodeprox-api/nodeprox-api.client.js";
import { CommandUserError } from "./command-user-error.js";

export const LINK_SUCCESS =
  "✅ Tu cuenta de Discord fue vinculada correctamente con NodeProx.";

function messageFor(error: unknown) {
  if (!(error instanceof NodeProxApiError))
    return "No se pudo completar la vinculación. Inténtalo nuevamente más tarde.";
  if (error.code === "discord-link-code-invalid")
    return "El código no es válido o ya expiró.";
  if (error.code === "discord-id-already-linked")
    return "Esta cuenta de Discord ya está vinculada a otra cuenta de NodeProx.";
  if (
    error.code === "discord-integration-disabled" ||
    error.code === "discord-guild-not-allowed" ||
    error.code === "discord-control-channel-required"
  )
    return "La integración de Discord no está disponible en este contexto.";
  if (error.code === "discord-interaction-already-processed")
    return LINK_SUCCESS;
  return "No se pudo completar la vinculación. Inténtalo nuevamente más tarde.";
}

export class LinkCommand {
  readonly name = "vincular";

  constructor(private readonly link: LinkDiscordAccount) {}

  async execute(interaction: ChatInputCommandInteraction) {
    const code = interaction.options.getString("codigo", true).trim();
    if (!code || code.length > 64) {
      await interaction.reply({
        content: "El código de vinculación no es válido.",
        ephemeral: true,
      });
      return;
    }
    if (!interaction.guildId || !interaction.channelId) {
      await interaction.reply({
        content: "Este comando debe utilizarse dentro del servidor autorizado.",
        ephemeral: true,
      });
      return;
    }
    try {
      await this.link.execute({
        code,
        discordId: interaction.user.id,
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        interactionId: interaction.id,
      });
      await interaction.reply({ content: LINK_SUCCESS, ephemeral: true });
    } catch (error) {
      throw new CommandUserError(messageFor(error), error);
    }
  }
}
