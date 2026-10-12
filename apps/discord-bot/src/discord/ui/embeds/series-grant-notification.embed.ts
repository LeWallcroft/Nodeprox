import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import { getDiscordEmbedColor } from "../discord-theme.js";

export function presentSeriesGrantNotification(input: {
  targetDiscordId: string;
  reference: string | null;
  webUrl: string;
}) {
  const embed = new EmbedBuilder()
    .setColor(getDiscordEmbedColor("success"))
    .setTitle("🎉 ¡Ya puedes crear una Serie!")
    .setDescription(
      "Se emitió una autorización disponible para crear una Serie en NodeProx.",
    )
    .addFields(
      { name: "✨ Permiso", value: "Crear una Serie", inline: true },
      { name: "🟢 Estado", value: "Disponible", inline: true },
      { name: "🔐 Uso", value: "Un solo uso", inline: true },
      {
        name: "🏷️ Referencia",
        value: input.reference || "Sin referencia",
        inline: false,
      },
    )
    .setFooter({ text: "NodeProx · Autorizaciones" });

  return {
    content: `<@${input.targetDiscordId}>`,
    embeds: [embed],
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel("🔗 Abrir NodeProx")
          .setStyle(ButtonStyle.Link)
          .setURL(input.webUrl),
      ),
    ],
    allowedMentions: { parse: [], users: [input.targetDiscordId] },
  };
}
