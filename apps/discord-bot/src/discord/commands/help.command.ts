import type { ChatInputCommandInteraction } from "discord.js";
import { presentHelp } from "../ui/presenters/help.presenter.js";
import { respondSafely } from "../interaction-response.js";

export class HelpCommand {
  readonly name = "ayuda";

  async execute(interaction: ChatInputCommandInteraction) {
    await respondSafely(interaction, presentHelp());
  }
}
