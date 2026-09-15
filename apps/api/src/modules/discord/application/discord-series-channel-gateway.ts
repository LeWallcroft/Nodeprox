export type SelectableSeriesChannel = {
  id: string;
  name: string;
};

export type SeriesChannelValidationReason =
  | "not_found"
  | "wrong_guild"
  | "unsupported_type"
  | "not_visible"
  | "control_channel";

export type SeriesChannelValidationResult =
  | { valid: true; channel: SelectableSeriesChannel }
  | { valid: false; reason: SeriesChannelValidationReason };

/** Read-only anti-corruption boundary owned by the Discord bot adapter. */
export interface DiscordSeriesChannelGateway {
  listSelectableChannels(): Promise<readonly SelectableSeriesChannel[]>;
  validateChannel(channelId: string): Promise<SeriesChannelValidationResult>;
}

export class DiscordSeriesChannelGatewayUnavailableError extends Error {}
