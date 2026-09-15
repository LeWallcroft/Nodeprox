import {
  type DiscordSeriesChannelGateway,
  DiscordSeriesChannelGatewayUnavailableError,
  type SelectableSeriesChannel,
  type SeriesChannelValidationReason,
  type SeriesChannelValidationResult,
} from "../application/discord-series-channel-gateway.js";

const snowflake = /^\d{17,20}$/;
const reasons = new Set<SeriesChannelValidationReason>([
  "not_found",
  "wrong_guild",
  "unsupported_type",
  "not_visible",
  "control_channel",
]);

function isChannel(value: unknown): value is SelectableSeriesChannel {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    "name" in value &&
    typeof value.id === "string" &&
    snowflake.test(value.id) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 200
  );
}

export class DiscordBotSeriesChannelGateway
  implements DiscordSeriesChannelGateway
{
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async listSelectableChannels(): Promise<readonly SelectableSeriesChannel[]> {
    const value = await this.request("/internal/discord/series-channels", {
      method: "GET",
    });
    if (
      !value ||
      typeof value !== "object" ||
      !("items" in value) ||
      !Array.isArray(value.items) ||
      !value.items.every(isChannel)
    )
      throw new DiscordSeriesChannelGatewayUnavailableError();
    return value.items;
  }

  async validateChannel(
    channelId: string,
  ): Promise<SeriesChannelValidationResult> {
    if (!snowflake.test(channelId))
      return { valid: false, reason: "not_found" };
    const value = await this.request(
      "/internal/discord/series-channels/validate",
      { method: "POST", body: JSON.stringify({ channelId }) },
    );
    if (!value || typeof value !== "object" || !("valid" in value))
      throw new DiscordSeriesChannelGatewayUnavailableError();
    if (value.valid === true && "channel" in value && isChannel(value.channel))
      return { valid: true, channel: value.channel };
    if (
      value.valid === false &&
      "reason" in value &&
      typeof value.reason === "string" &&
      reasons.has(value.reason as SeriesChannelValidationReason)
    )
      return {
        valid: false,
        reason: value.reason as SeriesChannelValidationReason,
      };
    throw new DiscordSeriesChannelGatewayUnavailableError();
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.baseUrl), {
        ...init,
        headers: {
          authorization: `Bearer ${this.internalToken}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new DiscordSeriesChannelGatewayUnavailableError();
    }
    if (!response.ok) throw new DiscordSeriesChannelGatewayUnavailableError();
    return response.json().catch(() => {
      throw new DiscordSeriesChannelGatewayUnavailableError();
    });
  }
}
