import { randomUUID } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  type ButtonInteraction,
  ButtonStyle,
  type ChatInputCommandInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type UserSelectMenuInteraction,
} from "discord.js";
import { IssueSeriesCreationGrant } from "../../application/issue-series-creation-grant.js";
import type { NodeProxDiscordApi } from "../../infrastructure/nodeprox-api/contracts.js";
import { NodeProxApiError } from "../../infrastructure/nodeprox-api/nodeprox-api.client.js";
import {
  getInteractionRoleIds,
  hasDiscordCapability,
} from "../guards/authorized-role.guard.js";
import {
  deferComponentUpdate,
  deferEphemeral,
  ephemeralPayload,
  respondSafely,
} from "../interaction-response.js";
import { CommandUserError } from "./command-user-error.js";
import { DiscordInteractionError } from "./discord-interaction-error.js";

const PREFIX = "nodeprox:series-grant:";
const EXPIRES_IN_MS = 10 * 60 * 1000;

type WorkflowStep = "target" | "reference" | "confirming";
type Workflow = {
  actorDiscordId: string;
  guildId: string;
  channelId: string;
  expiresAt: number;
  step: WorkflowStep;
  targetDiscordId?: string;
  reference?: string;
  submitting: boolean;
  completedContent?: string;
};

type WorkflowInteraction =
  | ButtonInteraction
  | UserSelectMenuInteraction
  | ModalSubmitInteraction;

function actionId(action: string, workflowId: string) {
  return `${PREFIX}${action}:${workflowId}`;
}

function parseAction(customId: string) {
  const match = new RegExp(`^${PREFIX}([a-z-]+):([a-f0-9-]{36})$`).exec(
    customId,
  );
  return match ? { action: match[1]!, workflowId: match[2]! } : null;
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
  readonly customIdPrefix = PREFIX;
  private readonly workflows = new Map<string, Workflow>();

  constructor(
    private readonly api: NodeProxDiscordApi,
    private readonly issueGrant = new IssueSeriesCreationGrant(api),
  ) {}

  async execute(interaction: ChatInputCommandInteraction) {
    await deferEphemeral(interaction);
    await this.requireIssuer(interaction);
    const workflowId = randomUUID();
    this.pruneExpired();
    this.workflows.set(workflowId, {
      actorDiscordId: interaction.user.id,
      guildId: interaction.guildId ?? "",
      channelId: interaction.channelId ?? "",
      expiresAt: Date.now() + EXPIRES_IN_MS,
      step: "target",
      submitting: false,
    });
    const selector =
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId(actionId("target", workflowId))
          .setMinValues(1)
          .setMaxValues(1)
          .setPlaceholder("Seleccionar usuario"),
      );
    await respondSafely(
      interaction,
      ephemeralPayload({
        content:
          "Selecciona al usuario de Discord que recibirá la autorización.",
        components: [
          selector,
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(actionId("cancel", workflowId))
              .setLabel("Cancelar")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      }),
    );
  }

  async executeComponent(interaction: WorkflowInteraction) {
    const parsed = parseAction(interaction.customId);
    if (!parsed) throw new DiscordInteractionError("invalid_component");
    const workflow = this.workflows.get(parsed.workflowId);
    if (!workflow || workflow.expiresAt <= Date.now()) {
      this.workflows.delete(parsed.workflowId);
      throw new DiscordInteractionError("stale_workflow");
    }
    if (
      interaction.user.id !== workflow.actorDiscordId ||
      interaction.guildId !== workflow.guildId ||
      interaction.channelId !== workflow.channelId
    )
      throw new CommandUserError(
        "Esta autorización no te pertenece.",
        undefined,
      );

    if (parsed.action === "target" && interaction.isUserSelectMenu())
      return this.selectTarget(interaction, workflow, parsed.workflowId);
    if (parsed.action === "continue" && interaction.isButton())
      return this.showReferenceModal(interaction, workflow, parsed.workflowId);
    if (parsed.action === "reference" && interaction.isModalSubmit())
      return this.confirmation(interaction, workflow, parsed.workflowId);
    if (parsed.action === "confirm" && interaction.isButton())
      return this.confirm(interaction, workflow);
    if (parsed.action === "cancel" && interaction.isButton())
      return this.cancel(interaction, parsed.workflowId);
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
    await interaction.update({
      content: `Usuario seleccionado: <@${targetDiscordId}>`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(actionId("continue", workflowId))
            .setLabel("Continuar")
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId(actionId("cancel", workflowId))
            .setLabel("Cancelar")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  private async showReferenceModal(
    interaction: ButtonInteraction,
    workflow: Workflow,
    workflowId: string,
  ) {
    if (!workflow.targetDiscordId)
      throw new CommandUserError("Selecciona primero un usuario.", undefined);
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(actionId("reference", workflowId))
        .setTitle("Referencia de autorización")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("reference")
              .setLabel("Referencia (opcional)")
              .setPlaceholder("Ej.: Proyecto Alpha / lote septiembre")
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setMaxLength(240),
          ),
        ),
    );
  }

  private async confirmation(
    interaction: ModalSubmitInteraction,
    workflow: Workflow,
    workflowId: string,
  ) {
    if (!workflow.targetDiscordId)
      throw new CommandUserError("Selecciona primero un usuario.", undefined);
    workflow.reference = interaction.fields
      .getTextInputValue("reference")
      .trim();
    workflow.step = "confirming";
    const reference = workflow.reference || "Sin referencia";
    await respondSafely(
      interaction,
      ephemeralPayload({
        content:
          `**Autorizar creación de Serie**\n\nUsuario: <@${workflow.targetDiscordId}>\nReferencia: ${reference}\n\n` +
          "Esta autorización permitirá crear exactamente una Serie. No expira y puede invalidarse mientras siga disponible.",
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
              .setCustomId(actionId("confirm", workflowId))
              .setLabel("Autorizar")
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(actionId("cancel", workflowId))
              .setLabel("Cancelar")
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
      }),
    );
  }

  private async confirm(interaction: ButtonInteraction, workflow: Workflow) {
    if (workflow.completedContent) {
      await interaction.update({
        content: workflow.completedContent,
        components: [],
      });
      return;
    }
    if (workflow.submitting) {
      await respondSafely(
        interaction,
        ephemeralPayload({ content: "La autorización ya se está procesando." }),
      );
      return;
    }
    if (!workflow.targetDiscordId)
      throw new CommandUserError("Selecciona primero un usuario.", undefined);
    workflow.submitting = true;
    try {
      await deferComponentUpdate(interaction);
      await this.requireIssuer(interaction);
      const result = await this.issueGrant.execute({
        targetDiscordId: workflow.targetDiscordId,
        ...(workflow.reference ? { reference: workflow.reference } : {}),
        actorDiscordId: interaction.user.id,
        actorRoleIds: getInteractionRoleIds(interaction),
        guildId: interaction.guildId ?? "",
        channelId: interaction.channelId ?? "",
        interactionId: interaction.id,
      });
      workflow.completedContent =
        `✅ **Autorización creada**\n\nUsuario: <@${workflow.targetDiscordId}>\n` +
        `Código: \`${result.displayCode}\`\nReferencia: ${result.reference ?? "Sin referencia"}\n` +
        "Estado: Disponible\n\nPermite crear exactamente una Serie.";
      await respondSafely(interaction, {
        content: workflow.completedContent,
        components: [],
      });
    } catch (error) {
      workflow.submitting = false;
      if (error instanceof CommandUserError) throw error;
      throw new CommandUserError(messageFor(error), error);
    }
  }

  private async cancel(interaction: ButtonInteraction, workflowId: string) {
    this.workflows.delete(workflowId);
    await interaction.update({
      content: "Autorización cancelada.",
      components: [],
    });
  }

  private async requireIssuer(
    interaction: ChatInputCommandInteraction | ButtonInteraction,
  ) {
    const integration = await this.api.getIntegration();
    if (!integration.enabled)
      throw new DiscordInteractionError("integration_disabled");
    if (interaction.guildId !== integration.guildId)
      throw new DiscordInteractionError("wrong_guild");
    if (interaction.channelId !== integration.controlChannelId)
      throw new DiscordInteractionError("wrong_channel");
    const actorRoleIds = getInteractionRoleIds(interaction);
    const actorHasIssueCapability = hasDiscordCapability(
      actorRoleIds,
      integration.authorizedRoles,
      "series_grant.issue",
    );
    if (!actorHasIssueCapability)
      throw new DiscordInteractionError("unauthorized");
  }

  private pruneExpired() {
    const now = Date.now();
    for (const [workflowId, workflow] of this.workflows)
      if (workflow.expiresAt <= now) this.workflows.delete(workflowId);
  }
}
