export type DiscordVerifiedGuildRole = {
  roleId: string;
  exists: boolean;
  name?: string;
  position?: number;
};

export type DiscordGuildRoleVerificationResult = {
  guildId: string;
  roles: readonly DiscordVerifiedGuildRole[];
};

/** A read-only boundary owned by the bot runtime, which is the only process
 * allowed to hold the Discord bot token. */
export interface DiscordGuildRoleVerifier {
  verifyRoles(input: {
    guildId: string;
    roleIds: readonly string[];
  }): Promise<DiscordGuildRoleVerificationResult>;
}

export class DiscordGuildRoleVerificationUnavailableError extends Error {}
