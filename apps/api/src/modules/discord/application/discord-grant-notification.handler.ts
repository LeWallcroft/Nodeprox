import { z } from "zod";
import type {
  DomainEventEnvelope,
  DomainEventHandler,
} from "../../events/application/domain-event-handler.js";
import type { DiscordDirectNotificationGateway } from "./discord-direct-notification.gateway.js";
import type { DiscordLinkedUserPort } from "./discord-linked-user.port.js";

const grantIssued = z.object({
  targetUserId: z.uuid(),
  source: z.enum(["web", "discord"]).default("discord"),
  reference: z.string().nullable().optional(),
});

export class DiscordGrantNotificationHandler implements DomainEventHandler {
  readonly handlerName = "discord-grant-notification";
  readonly eventTypes = ["series.creation_grant.issued"] as const;

  constructor(
    private readonly users: DiscordLinkedUserPort,
    private readonly notifications: DiscordDirectNotificationGateway,
  ) {}

  async handle(event: DomainEventEnvelope) {
    const payload = grantIssued.parse(event.payload);
    if (payload.source !== "web") return;
    const discordId = await this.users.findDiscordId(payload.targetUserId);
    if (!discordId) return;
    await this.notifications.sendSeriesGrantIssued({
      discordId,
      sourceEventId: event.id,
      reference: payload.reference ?? null,
    });
  }
}
