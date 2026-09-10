import { createHelpEmbed } from "../embeds/help.embed.js";
import {
  defaultHelpViewModel,
  type HelpViewModel,
} from "../view-models/help.view-model.js";

export function presentHelp(viewModel: HelpViewModel = defaultHelpViewModel) {
  return { embeds: [createHelpEmbed(viewModel)] };
}
