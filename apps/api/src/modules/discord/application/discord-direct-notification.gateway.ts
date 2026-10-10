export type DiscordDirectNotificationResult =
  | { status: "sent"; messageId: string }
  | { status: "skipped"; reason: "dm-unavailable" | "user-unavailable" };

export interface DiscordDirectNotificationGateway {
  sendSeriesGrantIssued(input: {
    discordId: string;
    sourceEventId: string;
    reference: string | null;
  }): Promise<DiscordDirectNotificationResult>;
}

export class DiscordDirectNotificationUnavailableError extends Error {
  constructor(readonly cause?: unknown) {
    super("discord-direct-notification-unavailable");
    this.name = "DiscordDirectNotificationUnavailableError";
  }
}
