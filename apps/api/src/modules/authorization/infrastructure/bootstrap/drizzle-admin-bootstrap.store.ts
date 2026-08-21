import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import {
  auditLogs,
  users,
} from "../../../../../../../database/schema/index.js";
import type {
  AdminBootstrapResult,
  AdminBootstrapStore,
} from "../../application/services/admin-bootstrap.service.js";
import { sanitizeAuditMetadata } from "../audit/audit-metadata.js";

export class DrizzleAdminBootstrapStore implements AdminBootstrapStore {
  constructor(private readonly database: NodeProxDatabase) {}

  async ensureAdmin(input: {
    email: string;
    createPasswordHash: () => Promise<string>;
  }): Promise<AdminBootstrapResult> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.email}, 0))`,
      );
      const existing =
        (
          await transaction
            .select()
            .from(users)
            .where(eq(users.email, input.email))
            .limit(1)
        )[0] ?? null;

      if (existing) {
        const outcome =
          existing.role === "admin" ? "already-admin" : "promoted";
        await transaction
          .update(users)
          .set({ role: "admin", updatedAt: new Date() })
          .where(eq(users.id, existing.id));
        await transaction.insert(auditLogs).values({
          actorId: existing.id,
          action: "admin_bootstrap_promoted",
          resourceType: "user",
          resourceId: existing.id,
          metadata: sanitizeAuditMetadata({
            fromRole: existing.role,
            toRole: "admin",
            result: outcome,
          }),
        });
        return { outcome, userId: existing.id };
      }

      const userId = randomUUID();
      const passwordHash = await input.createPasswordHash();
      await transaction.insert(users).values({
        id: userId,
        email: input.email,
        passwordHash,
        status: "active",
        role: "admin",
      });
      await transaction.insert(auditLogs).values({
        actorId: userId,
        action: "admin_bootstrap_created",
        resourceType: "user",
        resourceId: userId,
        metadata: sanitizeAuditMetadata({
          toRole: "admin",
          result: "created",
        }),
      });
      return { outcome: "created", userId };
    });
  }
}
