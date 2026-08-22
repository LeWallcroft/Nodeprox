import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapterPermissions,
  chapters,
  users,
} from "../../../../../../../../database/schema/index.js";
import { isCooldownActive } from "../../../domain/chapter-permission.policy.js";
import type {
  ChapterPermissionRepositoryPort,
  ChapterRepositoryPort,
  ChapterUserPort,
} from "../../../application/ports/chapter.ports.js";
import type {
  ChapterPermissionRecord,
  ChapterRecord,
} from "../../../domain/chapter.types.js";
import type { DelegableChapterPermission } from "../../../domain/chapter-permission.policy.js";
import type { AuthorizationAuditRepository } from "../../../../authorization/application/ports/authorization.ports.js";
import { sanitizeAuditMetadata } from "../../../../authorization/infrastructure/audit/audit-metadata.js";

const toChapter = (row: typeof chapters.$inferSelect): ChapterRecord => ({
  id: row.id,
  seriesId: row.seriesId,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toPermission = (
  row: typeof chapterPermissions.$inferSelect,
): ChapterPermissionRecord => ({
  id: row.id,
  chapterId: row.chapterId,
  helperUserId: row.helperUserId,
  permission: row.permission,
  grantedBy: row.grantedBy,
  grantedAt: row.grantedAt,
  revokedAt: row.revokedAt,
  revokedBy: row.revokedBy,
});

export class DrizzleChapterRepository
  implements
    ChapterRepositoryPort,
    ChapterUserPort,
    ChapterPermissionRepositoryPort,
    AuthorizationAuditRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async findById(id: string): Promise<ChapterRecord | null> {
    const row =
      (
        await this.db
          .select()
          .from(chapters)
          .where(eq(chapters.id, id))
          .limit(1)
      )[0] ?? null;
    return row ? toChapter(row) : null;
  }

  async existsById(id: string): Promise<boolean> {
    const row =
      (
        await this.db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, id))
          .limit(1)
      )[0] ?? null;
    return row !== null;
  }

  async grant(input: {
    chapterId: string;
    helperUserId: string;
    grantedBy: string;
    permissions: readonly DelegableChapterPermission[];
    cooldownDays: number;
    now: Date;
  }): Promise<
    | { outcome: "granted"; count: number }
    | { outcome: "conflict"; reason: "cooldown" | "already-granted" }
  > {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.chapterId}:${input.helperUserId}`}, 0))`,
      );
      const latestRevocation =
        (
          await tx
            .select({ revokedAt: chapterPermissions.revokedAt })
            .from(chapterPermissions)
            .where(
              and(
                eq(chapterPermissions.chapterId, input.chapterId),
                eq(chapterPermissions.helperUserId, input.helperUserId),
                sql`${chapterPermissions.revokedAt} is not null`,
              ),
            )
            .orderBy(desc(chapterPermissions.revokedAt))
            .limit(1)
        )[0]?.revokedAt ?? null;
      if (isCooldownActive(latestRevocation, input.cooldownDays, input.now))
        return { outcome: "conflict", reason: "cooldown" };

      const active = await tx
        .select({ permission: chapterPermissions.permission })
        .from(chapterPermissions)
        .where(
          and(
            eq(chapterPermissions.chapterId, input.chapterId),
            eq(chapterPermissions.helperUserId, input.helperUserId),
            isNull(chapterPermissions.revokedAt),
          ),
        );
      if (
        active.some((row) =>
          input.permissions.includes(
            row.permission as DelegableChapterPermission,
          ),
        )
      )
        return { outcome: "conflict", reason: "already-granted" };

      await tx.insert(chapterPermissions).values(
        input.permissions.map((permission) => ({
          chapterId: input.chapterId,
          helperUserId: input.helperUserId,
          permission,
          grantedBy: input.grantedBy,
          grantedAt: input.now,
        })),
      );
      await tx.insert(auditLogs).values({
        actorId: input.grantedBy,
        action: "chapter.permission.granted",
        resourceType: "chapter",
        resourceId: input.chapterId,
        metadata: sanitizeAuditMetadata({ result: "granted" }),
      });
      return { outcome: "granted", count: input.permissions.length };
    });
  }

  async revoke(input: {
    chapterId: string;
    helperUserId: string;
    revokedBy: string;
    now: Date;
  }): Promise<{ count: number }> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.chapterId}:${input.helperUserId}`}, 0))`,
      );
      const active = await tx
        .select({ id: chapterPermissions.id })
        .from(chapterPermissions)
        .where(
          and(
            eq(chapterPermissions.chapterId, input.chapterId),
            eq(chapterPermissions.helperUserId, input.helperUserId),
            isNull(chapterPermissions.revokedAt),
          ),
        );
      await tx
        .update(chapterPermissions)
        .set({ revokedAt: input.now, revokedBy: input.revokedBy })
        .where(
          and(
            eq(chapterPermissions.chapterId, input.chapterId),
            eq(chapterPermissions.helperUserId, input.helperUserId),
            isNull(chapterPermissions.revokedAt),
          ),
        );
      await tx.insert(auditLogs).values({
        actorId: input.revokedBy,
        action: "chapter.permission.revoked",
        resourceType: "chapter",
        resourceId: input.chapterId,
        metadata: sanitizeAuditMetadata({
          result: active.length > 0 ? "revoked" : "none",
        }),
      });
      return { count: active.length };
    });
  }

  async hasActivePermission(input: {
    chapterId: string;
    helperUserId: string;
    permission: DelegableChapterPermission;
  }): Promise<boolean> {
    const row =
      (
        await this.db
          .select({ id: chapterPermissions.id })
          .from(chapterPermissions)
          .where(
            and(
              eq(chapterPermissions.chapterId, input.chapterId),
              eq(chapterPermissions.helperUserId, input.helperUserId),
              eq(chapterPermissions.permission, input.permission),
              isNull(chapterPermissions.revokedAt),
            ),
          )
          .limit(1)
      )[0] ?? null;
    return row !== null;
  }

  async listActive(chapterId: string): Promise<ChapterPermissionRecord[]> {
    const rows = await this.db
      .select()
      .from(chapterPermissions)
      .where(
        and(
          eq(chapterPermissions.chapterId, chapterId),
          isNull(chapterPermissions.revokedAt),
        ),
      );
    return rows.map(toPermission);
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
}
