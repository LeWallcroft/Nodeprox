import { EmbedBuilder } from "discord.js";
import { getDiscordEmbedColor } from "../discord-theme.js";
import type { AuthorizeSeriesViewModel } from "../view-models/authorize-series.view-model.js";
import { visualStatus } from "../visual-status.js";

export function createAuthorizeSeriesEmbed(
  viewModel: AuthorizeSeriesViewModel,
) {
  const embed = new EmbedBuilder().setColor(getDiscordEmbedColor("info"));

  if (viewModel.state === "selecting-target")
    return embed
      .setTitle("🎟️ Autorizar creación de Serie")
      .setDescription(
        "Selecciona el usuario que recibirá una autorización de un solo uso para crear una Serie.",
      )
      .setFooter({ text: "NodeProx • Series Authorization" });

  if (viewModel.state === "target-selected")
    return embed
      .setTitle("🎟️ Autorizar creación de Serie")
      .setDescription(
        "Usuario seleccionado. Continúa para añadir una referencia opcional.",
      )
      .addFields(
        {
          name: "🎯 Usuario destinatario",
          value: `<@${viewModel.targetDiscordId}>\n${visualStatus("verified")}`,
        },
        { name: "🟡 Estado", value: "Usuario seleccionado" },
      )
      .setFooter({ text: "NodeProx • Series Authorization" });

  if (viewModel.state === "pending-confirmation")
    return embed
      .setTitle("🎟️ Autorizar creación de Serie")
      .setDescription(
        "Esta autorización permitirá crear exactamente una Serie.",
      )
      .addFields(
        {
          name: "🎯 Usuario destinatario",
          value: `<@${viewModel.targetDiscordId}>\n${visualStatus("verified")}`,
        },
        {
          name: "📝 Referencia",
          value: viewModel.reference ?? "Sin referencia",
        },
        { name: "🟡 Estado", value: visualStatus("pending") },
      )
      .setFooter({ text: "NodeProx • Series Authorization" });

  if (viewModel.state === "completed")
    return embed
      .setTitle("✅ Autorización creada")
      .setColor(getDiscordEmbedColor("success"))
      .addFields(
        {
          name: "👤 Usuario",
          value: `<@${viewModel.targetDiscordId}>\n${visualStatus("verified")}`,
        },
        { name: "🎟️ Código", value: `\`${viewModel.displayCode}\`` },
        { name: "🟢 Estado", value: visualStatus("available") },
        ...(viewModel.reference
          ? [{ name: "📝 Referencia", value: viewModel.reference }]
          : []),
      )
      .setFooter({ text: "NodeProx • Series Authorization" });

  return embed
    .setTitle("🎟️ Autorizar creación de Serie")
    .setColor(getDiscordEmbedColor("neutral"))
    .setDescription("El flujo fue cancelado.")
    .addFields({ name: "⚪ Estado", value: visualStatus("cancelled") })
    .setFooter({ text: "NodeProx • Series Authorization" });
}
