import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { createAuthorizeSeriesCustomId } from "../components/authorize-series.components.js";

export function createAuthorizeSeriesReferenceModal(workflowId: string) {
  return new ModalBuilder()
    .setCustomId(createAuthorizeSeriesCustomId(workflowId, "reference"))
    .setTitle("Referencia de autorización")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("reference")
          .setLabel("Referencia (opcional)")
          .setPlaceholder("Ej.: Proyecto Alpha / lote septiembre")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setMaxLength(240),
      ),
    );
}
