import { EmbedBuilder } from "discord.js";
import { getDiscordEmbedColor } from "../discord-theme.js";
import type { OperationalPanelViewModel } from "../view-models/configuration.view-model.js";

export function createConfigurationEmbed(viewModel: OperationalPanelViewModel) {
  return new EmbedBuilder()
    .setColor(getDiscordEmbedColor(viewModel.enabled ? "success" : "warning"))
    .setTitle("⚙️ Panel NodeProx")
    .setDescription(
      "Accede rápidamente a las acciones disponibles. La administración de roles y permisos se realiza desde NodeProx Web.",
    )
    .addFields({
      name: "Estado",
      value: viewModel.enabled
        ? "🟢 Integración activa\n🟢 Canal de control válido"
        : "🔴 Integración no disponible",
    })
    .setFooter({ text: "NodeProx • Discord Integration" });
}
