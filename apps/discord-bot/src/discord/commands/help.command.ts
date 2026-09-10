import type { ChatInputCommandInteraction } from "discord.js";
import { ephemeralPayload, respondSafely } from "../interaction-response.js";

export class HelpCommand {
  readonly name = "ayuda";

  async execute(interaction: ChatInputCommandInteraction) {
    await respondSafely(
      interaction,
      ephemeralPayload({
        content:
          "**NodeProx Bot**\n\n`/vincular`\nVincula tu cuenta Discord con NodeProx usando el código generado desde la web.\n\n`/autorizar-serie`\nAutoriza a un usuario vinculado a crear una Serie.\n\n`/ayuda`\nMuestra esta ayuda.",
      }),
    );
  }
}
