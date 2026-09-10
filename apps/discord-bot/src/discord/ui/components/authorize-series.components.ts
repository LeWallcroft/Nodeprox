import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
} from "discord.js";
import type { AuthorizeSeriesViewModel } from "../view-models/authorize-series.view-model.js";

export const authorizeSeriesCustomIdPrefix = "nodeprox:series-grant:";

export function createAuthorizeSeriesCustomId(
  workflowId: string,
  action: string,
): string {
  return `${authorizeSeriesCustomIdPrefix}${workflowId}:${action}`;
}

function cancelButton(workflowId: string) {
  return new ButtonBuilder()
    .setCustomId(createAuthorizeSeriesCustomId(workflowId, "cancel"))
    .setLabel("Cancelar")
    .setStyle(ButtonStyle.Secondary);
}

export function createAuthorizeSeriesComponents(
  viewModel: AuthorizeSeriesViewModel,
) {
  if (viewModel.state === "selecting-target")
    return [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(
            createAuthorizeSeriesCustomId(viewModel.workflowId, "target"),
          )
          .setMinValues(1)
          .setMaxValues(1)
          .setPlaceholder("Seleccionar usuario"),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        cancelButton(viewModel.workflowId),
      ),
    ];

  if (viewModel.state === "target-selected")
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createAuthorizeSeriesCustomId(viewModel.workflowId, "continue"),
          )
          .setLabel("Continuar")
          .setStyle(ButtonStyle.Primary),
        cancelButton(viewModel.workflowId),
      ),
    ];

  if (viewModel.state === "pending-confirmation")
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(
            createAuthorizeSeriesCustomId(viewModel.workflowId, "confirm"),
          )
          .setLabel("Autorizar")
          .setStyle(ButtonStyle.Primary),
        cancelButton(viewModel.workflowId),
      ),
    ];

  return [];
}
