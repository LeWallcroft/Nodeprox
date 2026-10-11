import {
  type DiscordDirectNotificationGateway,
  type DiscordDirectNotificationResult,
  DiscordDirectNotificationUnavailableError,
} from "../application/discord-direct-notification.gateway.js";

export class DiscordBotDirectNotificationGateway
  implements DiscordDirectNotificationGateway
{
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async sendSeriesGrantIssued(input: {
    discordId: string;
    sourceEventId: string;
    reference: string | null;
    webUrl: string;
  }): Promise<DiscordDirectNotificationResult> {
    let response: Response;
    try {
      response = await this.fetcher(
        new URL(
          `/internal/discord/users/${input.discordId}/notifications/series-grant`,
          this.baseUrl,
        ),
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.internalToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sourceEventId: input.sourceEventId,
            reference: input.reference,
            webUrl: input.webUrl,
          }),
          signal: AbortSignal.timeout(5_000),
        },
      );
    } catch (error) {
      throw new DiscordDirectNotificationUnavailableError(error);
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok || !payload || typeof payload !== "object")
      throw new DiscordDirectNotificationUnavailableError();
    const result = payload as Record<string, unknown>;
    if (result.status === "sent" && typeof result.messageId === "string")
      return { status: "sent", messageId: result.messageId };
    if (
      result.status === "skipped" &&
      (result.reason === "channel-unavailable" ||
        result.reason === "user-unavailable")
    )
      return { status: "skipped", reason: result.reason };
    throw new DiscordDirectNotificationUnavailableError();
  }
}
