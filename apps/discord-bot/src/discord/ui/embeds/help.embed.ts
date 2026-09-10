import { EmbedBuilder } from "discord.js";
import type { HelpViewModel } from "../view-models/help.view-model.js";

export function createHelpEmbed(viewModel: HelpViewModel) {
  return new EmbedBuilder()
    .setColor(0x8b5cf6)
    .setTitle("NodeProx Bot")
    .setDescription("Comandos disponibles en el canal de control.")
    .addFields(
      viewModel.commands.map((command) => ({
        name: command.name,
        value: command.description,
      })),
    );
}
