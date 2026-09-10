export const discordBotCapabilities = [
  "series_grant.issue",
  "series_grant.invalidate",
  "bot.configure",
] as const;

export type DiscordBotCapability = (typeof discordBotCapabilities)[number];

export type DiscordAuthorizedRoleReadModel = {
  roleId: string;
  capabilities: DiscordBotCapability[];
};

export type DiscordAuthorizedRoleFlags = {
  roleId: string;
  canIssueSeriesGrants: boolean;
  canInvalidateSeriesGrants: boolean;
  canConfigureBot: boolean;
};

export type DiscordAuthorizedRoleWrite = {
  roleId: string;
  canIssueSeriesGrants: boolean;
  canInvalidateSeriesGrants: boolean;
  canConfigureBot: boolean;
};

/** Keeps the database flag to bot-capability translation at one boundary. */
export function projectDiscordAuthorizedRole(
  role: DiscordAuthorizedRoleFlags,
): DiscordAuthorizedRoleReadModel {
  const capabilities: DiscordBotCapability[] = [];
  if (role.canIssueSeriesGrants) capabilities.push("series_grant.issue");
  if (role.canInvalidateSeriesGrants)
    capabilities.push("series_grant.invalidate");
  if (role.canConfigureBot) capabilities.push("bot.configure");
  return { roleId: role.roleId, capabilities };
}

/** Keeps the public bot-capability to database-flag translation at this same
 * policy boundary as the read projection. */
export function mapDiscordAuthorizedRoleWrite(
  role: DiscordAuthorizedRoleReadModel,
): DiscordAuthorizedRoleWrite {
  const capabilities = new Set(role.capabilities);
  return {
    roleId: role.roleId,
    canIssueSeriesGrants: capabilities.has("series_grant.issue"),
    canInvalidateSeriesGrants: capabilities.has("series_grant.invalidate"),
    canConfigureBot: capabilities.has("bot.configure"),
  };
}

export function hasDiscordCapability(
  actorRoleIds: readonly string[],
  authorizedRoles: readonly DiscordAuthorizedRoleReadModel[],
  capability: DiscordBotCapability,
) {
  const actorRoles = new Set(actorRoleIds);
  return authorizedRoles.some(
    (role) =>
      actorRoles.has(role.roleId) && role.capabilities.includes(capability),
  );
}
