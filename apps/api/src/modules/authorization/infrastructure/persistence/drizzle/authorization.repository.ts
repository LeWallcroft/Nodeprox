import { eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  systemConfig,
  users,
} from "../../../../../../../../database/schema/index.js";
import type {
  AuthorizationAuditRepository,
  AuthorizationConfigRepository,
  AuthorizationRoleRepository,
} from "../../../application/ports/authorization.ports.js";
import { sanitizeAuditMetadata } from "../../audit/audit-metadata.js";

export class DrizzleAuthorizationRepository
  implements
    AuthorizationRoleRepository,
    AuthorizationAuditRepository,
    AuthorizationConfigRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async findRoleByUserId(userId: string): Promise<string | null> {
    const row =
      (
        await this.db
          .select({ role: users.role })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1)
      )[0] ?? null;
    return row?.role ?? null;
  }

  async append(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      metadata: sanitizeAuditMetadata(input.metadata),
    });
  }

  async getHelperCooldownDays(): Promise<number> {
    const row =
      (
        await this.db
          .select({ value: systemConfig.value })
          .from(systemConfig)
          .where(eq(systemConfig.key, "helper_cooldown_days"))
          .limit(1)
      )[0] ?? null;
    if (!row || typeof row.value !== "number")
      throw new Error("helper_cooldown_days configuration is unavailable");
    if (!Number.isInteger(row.value) || row.value < 0)
      throw new Error("helper_cooldown_days configuration is invalid");
    return row.value;
  }
}
