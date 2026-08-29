import { eq, inArray } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  systemConfig,
  users,
} from "../../../../../../../../database/schema/index.js";
import type {
  AuthorizationAuditRepository,
  AuthorizationConfigRepository,
  ProductSettingsRepository,
  AuthorizationRoleRepository,
} from "../../../application/ports/authorization.ports.js";
import { sanitizeAuditMetadata } from "../../audit/audit-metadata.js";

export class DrizzleAuthorizationRepository
  implements
    AuthorizationRoleRepository,
    AuthorizationAuditRepository,
    AuthorizationConfigRepository,
    ProductSettingsRepository
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

  async read(
    keys: readonly string[],
  ): Promise<Map<string, number | boolean | string>> {
    const rows = await this.db
      .select({ key: systemConfig.key, value: systemConfig.value })
      .from(systemConfig)
      .where(inArray(systemConfig.key, [...keys]));
    return new Map(
      rows.flatMap((row) =>
        typeof row.value === "number" ||
        typeof row.value === "boolean" ||
        typeof row.value === "string"
          ? [[row.key, row.value] as const]
          : [],
      ),
    );
  }

  async write(
    changes: Array<[string, number | boolean | string]>,
    actorId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const [key, value] of changes) {
        await tx
          .insert(systemConfig)
          .values({ key, value, updatedBy: actorId })
          .onConflictDoUpdate({
            target: systemConfig.key,
            set: { value, updatedBy: actorId, updatedAt: new Date() },
          });
      }
    });
  }
}
