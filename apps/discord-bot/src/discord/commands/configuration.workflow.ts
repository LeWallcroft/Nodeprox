import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import type { NodeProxDiscordApi } from "../../infrastructure/nodeprox-api/contracts.js";
import {
  getInteractionRoleIds,
  hasDiscordCapability,
} from "../guards/authorized-role.guard.js";
import { respondSafely } from "../interaction-response.js";
import { operationalPanelCustomIdPrefix } from "../ui/components/configuration.components.js";
import { presentConfiguration } from "../ui/presenters/configuration.presenter.js";
import { presentHelp } from "../ui/presenters/help.presenter.js";
import type { AuthorizeSeriesWorkflow } from "./authorize-series.workflow.js";
import { DiscordInteractionError } from "./discord-interaction-error.js";

function parseAction(customId: string) {
  const match = new RegExp(`^${operationalPanelCustomIdPrefix}([a-z-]+)$`).exec(
    customId,
  );
  return match?.[1] ?? null;
}

/** Public operational entry point. Permission administration belongs to Web. */
export class OperationalPanel {
  readonly name = "panel";
  readonly customIdPrefix = operationalPanelCustomIdPrefix;

  constructor(
    private readonly api: NodeProxDiscordApi,
    private readonly authorizeSeries: AuthorizeSeriesWorkflow,
  ) {}

  async execute(interaction: ChatInputCommandInteraction) {
    const integration = await this.api.getIntegration();
    await respondSafely(
      interaction,
      presentConfiguration({
        enabled: integration.enabled,
        canAuthorizeSeries: hasDiscordCapability(
          getInteractionRoleIds(interaction),
          integration.authorizedRoles,
          "series_grant.issue",
        ),
      }),
    );
  }

  async executeComponent(
    interaction:
      | ButtonInteraction
      | UserSelectMenuInteraction
      | ModalSubmitInteraction,
  ) {
    if (!interaction.isButton())
      throw new DiscordInteractionError("invalid_component");
    const action = parseAction(interaction.customId);
    if (action === "authorize") {
      await this.authorizeSeries.execute(interaction);
      return;
    }
    if (action === "help") {
      await respondSafely(interaction, presentHelp());
      return;
    }
    throw new DiscordInteractionError("invalid_component");
  }
}
