import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../authorization/domain/permissions.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import type { DiscordProfileRepository } from "./discord-profile.repository.js";
import type { DiscordProfileSyncCoordinator } from "./discord-profile-sync.coordinator.js";

export class DiscordProfileMaintenanceForbiddenError extends Error {}

export class DiscordProfileMaintenanceService {
  constructor(
    private readonly authorization: AuthorizationService,
    private readonly repository: DiscordProfileRepository,
    private readonly coordinator: DiscordProfileSyncCoordinator,
    private readonly intervalMs: number,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async getStatus(context: AuthorizationContext) {
    await this.requireAccess(context);
    const status = await this.repository.getSyncStatus({
      staleBefore: new Date(this.clock().getTime() - this.intervalMs),
    });
    return {
      ...status,
      oldestSyncedAt: status.oldestSyncedAt?.toISOString() ?? null,
      syncRunning: this.coordinator.isRunning(),
    };
  }

  async triggerSync(context: AuthorizationContext, requestId: string) {
    await this.requireAccess(context);
    await this.authorization.recordSensitiveEvent({
      actorId: context.userId,
      action: "discord.profile_sync.triggered",
      resourceType: "discord-profile-sync",
      result: "success",
      requestId,
    });
    return this.coordinator.trigger({ mode: "force" });
  }

  private async requireAccess(context: AuthorizationContext): Promise<void> {
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.ADMIN_SYSTEM_MANAGE,
    );
    if (!decision.allowed) throw new DiscordProfileMaintenanceForbiddenError();
  }
}
