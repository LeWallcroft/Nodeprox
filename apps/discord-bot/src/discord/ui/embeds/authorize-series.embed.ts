import { EmbedBuilder } from "discord.js";
import type { AuthorizeSeriesViewModel } from "../view-models/authorize-series.view-model.js";

const accent = 0x8b5cf6;

export function createAuthorizeSeriesEmbed(
  viewModel: AuthorizeSeriesViewModel,
) {
  const embed = new EmbedBuilder().setColor(accent);
  const initiatedBy = `<@${viewModel.initiatedByDiscordUserId}>`;

  if (viewModel.state === "selecting-target")
    return embed
      .setTitle("Autorizar creación de Serie")
      .setDescription(`Iniciada por ${initiatedBy}`)
      .addFields({ name: "Estado", value: "Seleccionando usuario" });

  if (viewModel.state === "target-selected")
    return embed
      .setTitle("Autorizar creación de Serie")
      .setDescription(`Iniciada por ${initiatedBy}`)
      .addFields(
        { name: "Usuario", value: `<@${viewModel.targetDiscordId}>` },
        { name: "Estado", value: "Usuario seleccionado" },
      );

  if (viewModel.state === "pending-confirmation")
    return embed
      .setTitle("Autorizar creación de Serie")
      .setDescription(
        "Esta autorización permitirá crear exactamente una Serie.",
      )
      .addFields(
        { name: "Usuario", value: `<@${viewModel.targetDiscordId}>` },
        { name: "Referencia", value: viewModel.reference ?? "Sin referencia" },
        { name: "Estado", value: "Pendiente de confirmación" },
      );

  if (viewModel.state === "completed")
    return embed
      .setTitle("✅ Autorización creada")
      .addFields(
        { name: "Usuario", value: `<@${viewModel.targetDiscordId}>` },
        { name: "Código", value: `\`${viewModel.displayCode}\`` },
        { name: "Referencia", value: viewModel.reference ?? "Sin referencia" },
        { name: "Estado", value: "Disponible" },
      );

  return embed
    .setTitle("Autorizar creación de Serie")
    .setDescription(`Iniciada por ${initiatedBy}`)
    .addFields({ name: "Estado", value: "Cancelado" });
}
