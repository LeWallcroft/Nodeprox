import { EmbedBuilder } from "discord.js";
import { getDiscordEmbedColor } from "../discord-theme.js";
import type { HelpViewModel } from "../view-models/help.view-model.js";

export function createHelpEmbed(viewModel: HelpViewModel) {
  return new EmbedBuilder()
    .setColor(getDiscordEmbedColor("info"))
    .setTitle("❓ NodeProx Bot")
    .setDescription("Acciones disponibles en el Canal de Control.")
    .addFields(
      viewModel.commands.map((command) => ({
        name: command.name,
        value: command.description,
      })),
    )
    .setFooter({ text: "NodeProx • Discord Integration" });
}
