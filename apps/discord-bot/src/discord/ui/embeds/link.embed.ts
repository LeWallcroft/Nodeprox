import { EmbedBuilder } from "discord.js";
import { getDiscordEmbedColor } from "../discord-theme.js";

export function createLinkSuccessEmbed() {
  return new EmbedBuilder()
    .setColor(getDiscordEmbedColor("success"))
    .setTitle("✅ Cuenta vinculada")
    .setDescription("Tu identidad Discord quedó conectada con NodeProx.")
    .setFooter({ text: "NodeProx • Solo visible para ti" });
}
