import { createAuthorizeSeriesComponents } from "../components/authorize-series.components.js";
import { createAuthorizeSeriesEmbed } from "../embeds/authorize-series.embed.js";
import type { AuthorizeSeriesViewModel } from "../view-models/authorize-series.view-model.js";

export function presentAuthorizeSeries(viewModel: AuthorizeSeriesViewModel) {
  return {
    embeds: [createAuthorizeSeriesEmbed(viewModel)],
    components: createAuthorizeSeriesComponents(viewModel),
  };
}
