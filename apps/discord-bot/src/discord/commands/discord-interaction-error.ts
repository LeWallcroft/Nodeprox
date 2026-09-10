export type DiscordInteractionFailure =
  | "unauthorized"
  | "wrong_guild"
  | "wrong_channel"
  | "integration_disabled"
  | "stale_workflow"
  | "invalid_component"
  | "api_failure";

const messages: Record<DiscordInteractionFailure, string> = {
  unauthorized: "No tienes permisos para autorizar la creación de Series.",
  wrong_guild:
    "Este comando solo puede utilizarse en el servidor autorizado de NodeProx.",
  wrong_channel:
    "Este comando solo puede utilizarse en el canal autorizado de NodeProx.",
  integration_disabled: "La integración de Discord no está habilitada.",
  stale_workflow: "Esta acción ya no es válida.",
  invalid_component: "Esta acción ya no es válida.",
  api_failure:
    "No se pudo completar la solicitud. Inténtalo nuevamente más tarde.",
};

export class DiscordInteractionError extends Error {
  readonly userMessage: string;

  constructor(
    readonly failure: DiscordInteractionFailure,
    readonly cause?: unknown,
  ) {
    super(`discord-interaction-${failure}`);
    this.userMessage = messages[failure];
  }
}
