import { randomUUID } from "node:crypto";
import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  UserSelectMenuInteraction,
} from "discord.js";
import { IssueSeriesCreationGrant } from "../../application/issue-series-creation-grant.js";
import type { NodeProxDiscordApi } from "../../infrastructure/nodeprox-api/contracts.js";
import { NodeProxApiError } from "../../infrastructure/nodeprox-api/nodeprox-api.client.js";
import {
  authorizeSeriesCustomIdPrefix,
  createAuthorizeSeriesCustomId,
} from "../ui/components/authorize-series.components.js";
import { createAuthorizeSeriesReferenceModal } from "../ui/modals/authorize-series-reference.modal.js";
import { presentAuthorizeSeries } from "../ui/presenters/authorize-series.presenter.js";
import type { AuthorizeSeriesViewModel } from "../ui/view-models/authorize-series.view-model.js";
import {
  getInteractionRoleIds,
  hasDiscordCapability,
} from "../guards/authorized-role.guard.js";
import {
  deferComponentUpdate,
  respondSafely,
} from "../interaction-response.js";
import { CommandUserError } from "./command-user-error.js";
import { DiscordInteractionError } from "./discord-interaction-error.js";

const EXPIRES_IN_MS = 10 * 60 * 1000;

type WorkflowStep = "target" | "reference" | "confirming" | "completed";
type Workflow = {
  actorDiscordId: string;
  guildId: string;
  channelId: string;
  expiresAt: number;
  step: WorkflowStep;
  targetDiscordId?: string;
  reference?: string;
  submitting: boolean;
};

type WorkflowInteraction =
  | ButtonInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

function parseAction(customId: string) {
  const match = new RegExp(
    `^${authorizeSeriesCustomIdPrefix}([a-f0-9-]{36}):([a-z-]+)$`,
  ).exec(customId);
  return match ? { workflowId: match[1]!, action: match[2]! } : null;
}

function messageFor(error: unknown) {
  if (!(error instanceof NodeProxApiError))
    return "No se pudo crear la autorización. Inténtalo nuevamente más tarde.";
  if (error.code === "discord-not-linked")
    return "El usuario seleccionado no tiene una cuenta NodeProx vinculada.";
  if (error.code === "discord-actor-role-not-authorized")
    return "No tienes permisos para autorizar la creación de Series.";
  if (error.code === "discord-integration-disabled")
    return "La integración de Discord no está habilitada.";
  if (error.code === "discord-guild-not-allowed")
    return "Este comando solo puede utilizarse en el servidor autorizado de NodeProx.";
  if (error.code === "discord-control-channel-required")
    return "Este comando solo puede utilizarse en el canal autorizado de NodeProx.";
  return "No se pudo crear la autorización. Inténtalo nuevamente más tarde.";
}

export class AuthorizeSeriesWorkflow {
  readonly name = "autorizar-serie";
  readonly customIdPrefix = authorizeSeriesCustomIdPrefix;
  private readonly workflows = new Map<string, Workflow>();

  constructor(
    private readonly api: NodeProxDiscordApi,
    private readonly issueGrant = new IssueSeriesCreationGrant(api),
  ) {}

  async execute(interaction: ChatInputCommandInteraction) {
    await this.requireIssuer(interaction);
    const workflowId = randomUUID();
    const workflow: Workflow = {
      actorDiscordId: interaction.user.id,
      guildId: interaction.guildId ?? "",
      channelId: interaction.channelId ?? "",
      expiresAt: Date.now() + EXPIRES_IN_MS,
      step: "target",
      submitting: false,
    };
    this.pruneExpired();
    this.workflows.set(workflowId, workflow);
    await respondSafely(
      interaction,
      presentAuthorizeSeries(this.toViewModel(workflowId, workflow)),
    );
  }

  async executeComponent(interaction: WorkflowInteraction) {
    const parsed = parseAction(interaction.customId);
    if (!parsed) throw new DiscordInteractionError("invalid_component");
    const workflow = this.workflows.get(parsed.workflowId);
    if (
      !workflow ||
      workflow.expiresAt <= Date.now() ||
      workflow.step === "completed"
    ) {
      this.workflows.delete(parsed.workflowId);
      throw new DiscordInteractionError("stale_workflow");
    }
    if (
      interaction.user.id !== workflow.actorDiscordId ||
      interaction.guildId !== workflow.guildId ||
      interaction.channelId !== workflow.channelId
    )
      throw new CommandUserError(
        "No tienes permisos para interactuar con esta acción.",
        undefined,
      );

    await this.requireIssuer(interaction);

    if (parsed.action === "target" && interaction.isUserSelectMenu()) {
      this.requireStep(workflow, "target");
      return this.selectTarget(interaction, workflow, parsed.workflowId);
    }
    if (parsed.action === "continue" && interaction.isButton()) {
      this.requireStep(workflow, "reference");
      return this.showReferenceModal(interaction, workflow, parsed.workflowId);
    }
    if (parsed.action === "reference" && interaction.isModalSubmit()) {
      this.requireStep(workflow, "reference");
      return this.confirmation(interaction, workflow, parsed.workflowId);
    }
    if (parsed.action === "confirm" && interaction.isButton()) {
      this.requireStep(workflow, "confirming");
      return this.confirm(interaction, workflow);
    }
    if (parsed.action === "cancel" && interaction.isButton())
      return this.cancel(interaction, workflow, parsed.workflowId);
    throw new DiscordInteractionError("invalid_component");
  }

  private async selectTarget(
    interaction: UserSelectMenuInteraction,
    workflow: Workflow,
    workflowId: string,
  ) {
    const targetDiscordId = interaction.values[0];
    if (!targetDiscordId)
      throw new CommandUserError(
        "Selecciona exactamente un usuario.",
        undefined,
      );
    workflow.targetDiscordId = targetDiscordId;
    workflow.step = "reference";
    await interaction.update(
      presentAuthorizeSeries(this.toViewModel(workflowId, workflow)),
    );
  }

  private async showReferenceModal(
    interaction: ButtonInteraction,
    workflow: Workflow,
    workflowId: string,
  ) {
    if (!workflow.targetDiscordId)
      throw new CommandUserError("Selecciona primero un usuario.", undefined);
    await interaction.showModal(
      createAuthorizeSeriesReferenceModal(workflowId),
    );
  }

  private async confirmation(
    interaction: ModalSubmitInteraction,
    workflow: Workflow,
    workflowId: string,
  ) {
    if (!workflow.targetDiscordId)
      throw new CommandUserError("Selecciona primero un usuario.", undefined);
    if (!interaction.isFromMessage())
      throw new DiscordInteractionError("invalid_component");
    workflow.reference = interaction.fields
      .getTextInputValue("reference")
      .trim();
    workflow.step = "confirming";
    await interaction.update(
      presentAuthorizeSeries(this.toViewModel(workflowId, workflow)),
    );
  }

  private async confirm(interaction: ButtonInteraction, workflow: Workflow) {
    if (workflow.submitting) {
      await respondSafely(interaction, {
        content: "La autorización ya se está procesando.",
      });
      return;
    }
    if (!workflow.targetDiscordId)
      throw new CommandUserError("Selecciona primero un usuario.", undefined);
    workflow.submitting = true;
    try {
      await deferComponentUpdate(interaction);
      const result = await this.issueGrant.execute({
        targetDiscordId: workflow.targetDiscordId,
        ...(workflow.reference ? { reference: workflow.reference } : {}),
        actorDiscordId: interaction.user.id,
        actorRoleIds: getInteractionRoleIds(interaction),
        guildId: interaction.guildId ?? "",
        channelId: interaction.channelId ?? "",
        interactionId: interaction.id,
      });
      workflow.step = "completed";
      await respondSafely(
        interaction,
        presentAuthorizeSeries({
          state: "completed",
          initiatedByDiscordUserId: workflow.actorDiscordId,
          targetDiscordId: workflow.targetDiscordId,
          reference: result.reference,
          displayCode: result.displayCode,
        }),
      );
    } catch (error) {
      workflow.submitting = false;
      if (error instanceof CommandUserError) throw error;
      throw new CommandUserError(messageFor(error), error);
    }
  }

  private async cancel(
    interaction: ButtonInteraction,
    workflow: Workflow,
    workflowId: string,
  ) {
    this.workflows.delete(workflowId);
    await interaction.update(
      presentAuthorizeSeries({
        state: "cancelled",
        initiatedByDiscordUserId: workflow.actorDiscordId,
      }),
    );
  }

  private toViewModel(
    workflowId: string,
    workflow: Workflow,
  ): AuthorizeSeriesViewModel {
    if (workflow.step === "target")
      return {
        state: "selecting-target",
        workflowId,
        initiatedByDiscordUserId: workflow.actorDiscordId,
      };
    if (workflow.step === "reference")
      return {
        state: "target-selected",
        workflowId,
        initiatedByDiscordUserId: workflow.actorDiscordId,
        targetDiscordId: workflow.targetDiscordId ?? "",
      };
    return {
      state: "pending-confirmation",
      workflowId,
      initiatedByDiscordUserId: workflow.actorDiscordId,
      targetDiscordId: workflow.targetDiscordId ?? "",
      reference: workflow.reference || null,
    };
  }

  private requireStep(workflow: Workflow, step: WorkflowStep) {
    if (workflow.step !== step)
      throw new DiscordInteractionError("stale_workflow");
  }

  private async requireIssuer(
    interaction: ChatInputCommandInteraction | WorkflowInteraction,
  ) {
    const integration = await this.api.getIntegration();
    if (!integration.enabled)
      throw new DiscordInteractionError("integration_disabled");
    if (interaction.guildId !== integration.guildId)
      throw new DiscordInteractionError("wrong_guild");
    if (interaction.channelId !== integration.controlChannelId)
      throw new DiscordInteractionError("wrong_channel");
    if (
      !hasDiscordCapability(
        getInteractionRoleIds(interaction),
        integration.authorizedRoles,
        "series_grant.issue",
      )
    )
      throw new DiscordInteractionError("unauthorized");
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [workflowId, workflow] of this.workflows)
      if (workflow.expiresAt <= now) this.workflows.delete(workflowId);
  }
}

export { createAuthorizeSeriesCustomId };
