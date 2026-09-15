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

export class NotificationProjector implements DomainEventHandler {
  readonly handlerName = "notification-projector";
  readonly eventTypes = ["series.creation_grant.issued"] as const;

  constructor(private readonly notifications: NotificationRepository) {}

  async handle(event: DomainEventEnvelope): Promise<void> {
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

export class NotificationProjectionError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
