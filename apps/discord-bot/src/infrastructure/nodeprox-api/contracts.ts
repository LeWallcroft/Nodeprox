export type ConfirmDiscordLinkInput = {
  code: string;
  discordId: string;
  guildId: string;
  channelId: string;
  interactionId: string;
  actorDiscordId: string;
};

export type ConfirmDiscordLinkResult = {
  linked: boolean;
  idempotent: boolean;
};

export type DiscordIntegrationConfig = {
  guildId: string;
  controlChannelId: string;
  enabled: boolean;
};

export interface NodeProxDiscordApi {
  confirmLink(
    input: ConfirmDiscordLinkInput,
  ): Promise<ConfirmDiscordLinkResult>;
  getIntegration(): Promise<DiscordIntegrationConfig>;
}
