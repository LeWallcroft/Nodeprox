import type { ChatInputCommandInteraction } from "discord.js";

export class HelpCommand {
  readonly name = "ayuda";

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.reply({
      content:
        "**NodeProx Bot**\n\n`/vincular`\nVincula tu cuenta Discord con NodeProx usando el código generado desde la web.\n\n`/ayuda`\nMuestra esta ayuda.",
      ephemeral: true,
    });
  }
}
