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

export type DiscordBotCapability =
  | "series_grant.issue"
  | "series_grant.invalidate"
  | "bot.configure";

export type DiscordAuthorizedRole = {
  roleId: string;
  capabilities: readonly DiscordBotCapability[];
};

export type DiscordIntegrationConfig = {
  guildId: string;
  controlChannelId: string;
  enabled: boolean;
  authorizedRoles: readonly DiscordAuthorizedRole[];
};

export type IssueSeriesCreationGrantInput = {
  targetDiscordId: string;
  reference?: string;
  actorDiscordId: string;
  actorRoleIds: string[];
  guildId: string;
  channelId: string;
  interactionId: string;
};

export type IssueSeriesCreationGrantResult = {
  id: string;
  displayCode: string;
  reference: string | null;
  status: "available";
  issuedAt: string;
  targetUser: { id: string; username: string };
};

export interface NodeProxDiscordApi {
  confirmLink(
    input: ConfirmDiscordLinkInput,
  ): Promise<ConfirmDiscordLinkResult>;
  getIntegration(): Promise<DiscordIntegrationConfig>;
  issueSeriesCreationGrant(
    input: IssueSeriesCreationGrantInput,
  ): Promise<IssueSeriesCreationGrantResult>;
}
