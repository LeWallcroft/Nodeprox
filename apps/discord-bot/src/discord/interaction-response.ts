import {
  MessageFlags,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageComponentInteraction,
  type RepliableInteraction,
} from "discord.js";

export type SafeInteractionPayload = Omit<InteractionReplyOptions, "ephemeral">;

export function ephemeralPayload(
  payload: SafeInteractionPayload,
): SafeInteractionPayload {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

export async function deferEphemeral(
  interaction: RepliableInteraction,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied)
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

export async function deferComponentUpdate(
  interaction: MessageComponentInteraction,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied)
    await interaction.deferUpdate();
}

/** Applies exactly one response path for an interaction's current ACK state. */
export async function respondSafely(
  interaction: RepliableInteraction,
  payload: SafeInteractionPayload,
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.reply(payload);
    return;
  }
  const { flags: _flags, ...edit } = payload;
  if (interaction.deferred) {
    await interaction.editReply(edit as InteractionEditReplyOptions);
    return;
  }
  await interaction.followUp(payload);
}

export function interactionErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  return typeof code === "number" || typeof code === "string"
    ? String(code)
    : null;
}

export function isInteractionLifecycleError(error: unknown) {
  const code = interactionErrorCode(error);
  return code === "10062" || code === "40060";
}
