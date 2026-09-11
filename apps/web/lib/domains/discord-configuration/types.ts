export const discordCapabilities = [
  "series_grant.issue",
  "series_grant.invalidate",
  "bot.configure",
] as const;

export type DiscordCapability = (typeof discordCapabilities)[number];
export type DiscordAuthorizedRole = {
  roleId: string;
  capabilities: DiscordCapability[];
};
export type DiscordAuthorizationConfiguration = {
  guildId: string;
  roles: DiscordAuthorizedRole[];
};
