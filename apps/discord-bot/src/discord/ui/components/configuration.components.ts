import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { OperationalPanelViewModel } from "../view-models/configuration.view-model.js";

export const operationalPanelCustomIdPrefix = "nodeprox:operational:";
const operationalPanelCustomId = (action: "authorize" | "help") =>
  `${operationalPanelCustomIdPrefix}${action}`;

export function createConfigurationComponents(
  viewModel: OperationalPanelViewModel,
) {
  const actions = [
    ...(viewModel.canAuthorizeSeries
      ? [
          new ButtonBuilder()
            .setCustomId(operationalPanelCustomId("authorize"))
            .setLabel("Autorizar Serie")
            .setStyle(ButtonStyle.Primary),
        ]
      : []),
    new ButtonBuilder()
      .setCustomId(operationalPanelCustomId("help"))
      .setLabel("Ayuda")
      .setStyle(ButtonStyle.Secondary),
  ];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(actions)];
}
