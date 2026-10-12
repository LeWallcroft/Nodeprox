import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../authorization/domain/permissions.js";
import type { DiscordProfileRepository } from "./discord-profile.repository.js";
import type { DiscordProfileSyncCoordinator } from "./discord-profile-sync.coordinator.js";

export class DiscordProfileSyncAdministrationForbiddenError extends Error {}

export class DiscordProfileSyncAdministrationService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: DiscordProfileRepository,
    private readonly coordinator: DiscordProfileSyncCoordinator,
    private readonly intervalMs: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getStatus(context: AuthorizationContext) {
    await this.requireAccess(context);
    const [status, syncRunning] = await Promise.all([
      this.repository.getSyncStatus({
        staleBefore: new Date(this.clock().getTime() - this.intervalMs),
      }),
      this.coordinator.isRunningDistributed(),
    ]);
    return {
      ...status,
      oldestSyncedAt: status.oldestSyncedAt?.toISOString() ?? null,
      syncRunning,
    };
  }

  async triggerSync(context: AuthorizationContext, requestId: string) {
    await this.requireAccess(context);
    const result = await this.coordinator.trigger({ mode: "force" });
    await this.authorization.recordSensitiveEvent({
      actorId: context.userId,
      action: "discord.profile_sync.triggered",
      resourceType: "discord-profile-sync",
      result: result.accepted ? "success" : "rejected",
      ...(!result.accepted ? { reasonCode: "already-running" } : {}),
      requestId,
    });
    return result;
  }

  private async requireAccess(context: AuthorizationContext): Promise<void> {
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.DISCORD_INTEGRATION_CONFIGURE,
    );
    if (!decision.allowed)
      throw new DiscordProfileSyncAdministrationForbiddenError();
  }
}
