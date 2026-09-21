import { z } from "zod";
import type {
  DomainEventEnvelope,
  DomainEventHandler,
} from "../../events/application/domain-event-handler.js";
import type { NotificationRepository } from "./notification.repository.js";

const grantIssuedPayload = z
  .object({
    targetUserId: z.uuid(),
  })
  .passthrough();
const uploadPayload = z
  .object({
    targetUserId: z.uuid(),
    operationKind: z.enum([
      "chapter_import",
      "chapter_replacement",
      "image_replacement",
    ]),
  })
  .passthrough();

export class NotificationProjector implements DomainEventHandler {
  readonly handlerName = "notification-projector";
  readonly eventTypes = [
    "series.creation_grant.issued",
    "upload.completed",
    "upload.failed",
  ] as const;

  constructor(private readonly notifications: NotificationRepository) {}

  async handle(event: DomainEventEnvelope): Promise<void> {
    if (
      event.eventType === "upload.completed" ||
      event.eventType === "upload.failed"
    ) {
      const payload = uploadPayload.parse(event.payload);
      const completed = event.eventType === "upload.completed";
      await this.notifications.createIfAbsent({
        userId: payload.targetUserId,
        sourceEventId: event.id,
        type: event.eventType,
        title: completed ? "Carga completada" : "La carga requiere atención",
        message: uploadMessage(payload.operationKind, completed),
        entityType: event.aggregateType,
        entityId: event.aggregateId,
        actionKey: "chapters",
      });
      return;
    }
    const payload = grantIssuedPayload.parse(event.payload);
    if (!z.uuid().safeParse(event.aggregateId).success)
      throw new NotificationProjectionError("invalid-grant-identifier");

    await this.notifications.createIfAbsent({
      userId: payload.targetUserId,
      sourceEventId: event.id,
      type: event.eventType,
      title: "Nueva autorización disponible",
      message: "Tienes una nueva autorización disponible para crear una Serie.",
      entityType: "series_creation_grant",
      entityId: event.aggregateId,
      actionKey: "authorizations",
    });
  }
}

function uploadMessage(
  kind: z.infer<typeof uploadPayload>["operationKind"],
  completed: boolean,
) {
  const target =
    kind === "image_replacement"
      ? "El cambio de imagen"
      : kind === "chapter_replacement"
        ? "El cambio de capítulo"
        : "La carga de capítulo";
  return completed
    ? `${target} finalizó correctamente.`
    : `${target} no pudo completarse. Revisa el Centro de cargas.`;
}

export class NotificationProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
