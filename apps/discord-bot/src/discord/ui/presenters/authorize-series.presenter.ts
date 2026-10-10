import { createAuthorizeSeriesComponents } from "../components/authorize-series.components.js";
import { createAuthorizeSeriesEmbed } from "../embeds/authorize-series.embed.js";
import type { AuthorizeSeriesViewModel } from "../view-models/authorize-series.view-model.js";

export function presentAuthorizeSeries(viewModel: AuthorizeSeriesViewModel) {
  const completed = viewModel.state === "completed";
  return {
    ...(completed
      ? {
          content: `<@${viewModel.targetDiscordId}> tienes una nueva autorización disponible en NodeProx.`,
          allowedMentions: { parse: [], users: [viewModel.targetDiscordId] },
        }
      : {}),
    embeds: [createAuthorizeSeriesEmbed(viewModel)],
    components: createAuthorizeSeriesComponents(viewModel),
  };
}
