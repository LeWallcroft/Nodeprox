import { eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  discordAuthorizedRoles,
  discordIntegrations,
} from "../../../../../../../../database/schema/index.js";
import { sanitizeAuditMetadata } from "../../../../authorization/infrastructure/audit/audit-metadata.js";
import {
  type DiscordAuthorizedRoleWrite,
  projectDiscordAuthorizedRole,
} from "../../../application/discord-authorization-policy.js";
import type {
  DiscordAuthorizedRoleConfigurationRepository,
  DiscordAuthorizedRolesResponse,
} from "../../../application/discord-role-configuration.service.js";

export class DrizzleDiscordAuthorizedRoleConfigurationRepository
  implements DiscordAuthorizedRoleConfigurationRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async list(): Promise<DiscordAuthorizedRolesResponse | null> {
    const [integration] = await this.db
      .select()
      .from(discordIntegrations)
      .limit(1);
    if (!integration) return null;
    const rows = await this.db
      .select()
      .from(discordAuthorizedRoles)
      .where(eq(discordAuthorizedRoles.integrationId, integration.id));
    return {
      guildId: integration.guildId,
      roles: rows.map(projectDiscordAuthorizedRole),
    };
  }

  async replace(input: {
    actorUserId: string;
    requestId?: string;
    roles: readonly DiscordAuthorizedRoleWrite[];
  }): Promise<DiscordAuthorizedRolesResponse | null> {
    return this.db.transaction(async (tx) => {
      const [integration] = await tx
        .select()
        .from(discordIntegrations)
        .limit(1)
        .for("update");
      if (!integration) return null;
      const previous = await tx
        .select()
        .from(discordAuthorizedRoles)
        .where(eq(discordAuthorizedRoles.integrationId, integration.id));
      await tx
        .delete(discordAuthorizedRoles)
        .where(eq(discordAuthorizedRoles.integrationId, integration.id));
      if (input.roles.length) {
        await tx.insert(discordAuthorizedRoles).values(
          input.roles.map((role) => ({
            integrationId: integration.id,
            roleId: role.roleId,
            canIssueSeriesGrants: role.canIssueSeriesGrants,
            canInvalidateSeriesGrants: role.canInvalidateSeriesGrants,
            canConfigureBot: role.canConfigureBot,
            createdBy: input.actorUserId,
          })),
        );
      }
      const count = (capability: keyof DiscordAuthorizedRoleWrite) =>
        input.roles.filter((role) => role[capability] === true).length;
      await tx.insert(auditLogs).values({
        actorId: input.actorUserId,
        action: "discord.integration.config.updated",
        resourceType: "discord_integration",
        resourceId: integration.id,
        result: "success",
        ...(input.requestId ? { requestId: input.requestId } : {}),
        metadata: sanitizeAuditMetadata({
          guildId: integration.guildId,
          previousRoleCount: previous.length,
          newRoleCount: input.roles.length,
          issueCapabilityCount: count("canIssueSeriesGrants"),
          invalidateCapabilityCount: count("canInvalidateSeriesGrants"),
          configureCapabilityCount: count("canConfigureBot"),
        }),
      });
      return {
        guildId: integration.guildId,
        roles: input.roles.map(projectDiscordAuthorizedRole),
      };
    });
  }
}
