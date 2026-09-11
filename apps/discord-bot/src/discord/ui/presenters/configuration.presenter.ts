import { createConfigurationComponents } from "../components/configuration.components.js";
import { createConfigurationEmbed } from "../embeds/configuration.embed.js";
import type { OperationalPanelViewModel } from "../view-models/configuration.view-model.js";

export function presentConfiguration(viewModel: OperationalPanelViewModel) {
  return {
    embeds: [createConfigurationEmbed(viewModel)],
    components: createConfigurationComponents(viewModel),
  };
}
