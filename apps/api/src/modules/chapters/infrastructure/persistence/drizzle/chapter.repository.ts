import { and, eq, gt, isNull } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapterPermissions,
  chapters,
  helperSeriesCooldowns,
  series,
  seriesAssignments,
  users,
} from "../../../../../../../../database/schema/index.js";
import type { AuthorizationAuditRepository } from "../../../../authorization/application/ports/authorization.ports.js";
import { PERMISSIONS } from "../../../../authorization/domain/permissions.js";
import { sanitizeAuditMetadata } from "../../../../authorization/infrastructure/audit/audit-metadata.js";
import { lockCurrentAuthorization } from "../../../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";
import type {
  ChapterPermissionRepositoryPort,
  ChapterRepositoryPort,
  ChapterUserPort,
} from "../../../application/ports/chapter.ports.js";
import type {
  ChapterPermissionRecord,
  ChapterRecord,
} from "../../../domain/chapter.types.js";
import {
  type DelegableChapterPermission,
  evaluateChapterAdministrationAuthorization,
} from "../../../domain/chapter-permission.policy.js";

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

  async isAssigned(seriesId: string, userId: string): Promise<boolean> {
    const row =
      (
        await this.db
          .select({ id: seriesAssignments.id })
          .from(seriesAssignments)
          .where(
            and(
              eq(seriesAssignments.seriesId, seriesId),
              eq(seriesAssignments.responsibleUserId, userId),
            ),
          )
          .limit(1)
      )[0] ?? null;
    return row !== null;
  }

  async isSeriesOwner(seriesId: string, userId: string): Promise<boolean> {
    const row =
      (
        await this.db
          .select({ id: series.id })
          .from(series)
          .where(and(eq(series.id, seriesId), eq(series.createdBy, userId)))
          .limit(1)
      )[0] ?? null;
    return row !== null;
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

  async findUserById(id: string) {
    const [row] = await this.db
      .select({ id: users.id, status: users.status, role: users.role })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return row ?? null;
  }

  async grant(input: {
    actor: Parameters<ChapterPermissionRepositoryPort["grant"]>[0]["actor"];
    chapterId: string;
    helperUserId: string;
    permissions: readonly DelegableChapterPermission[];
    cooldownDays: number;
    now: Date;
  }): Promise<
    | { outcome: "granted"; count: number }
    | { outcome: "conflict"; reason: "cooldown" | "already-granted" }
    | { outcome: "denied" }
    | { outcome: "not-found" }
  > {
    const snapshot = await this.findById(input.chapterId);
    if (!snapshot) return { outcome: "not-found" };
    return this.db.transaction(async (tx) => {
      const actor = await lockCurrentAuthorization({
        tx,
        actor: input.actor,
        permission: PERMISSIONS.CHAPTERS_HELPER_GRANT,
        additionalUserIds: [input.helperUserId],
      });
      if (!actor.allowed) return { outcome: "denied" as const };
      const helper = actor.usersById.get(input.helperUserId);
      if (!helper) return { outcome: "not-found" as const };
      if (helper.status !== "active" || helper.role !== "uploader")
        return { outcome: "denied" as const };

      const [lockedSeries] = await tx
        .select({ id: series.id })
        .from(series)
        .where(eq(series.id, snapshot.seriesId))
        .limit(1)
        .for("update");
      if (!lockedSeries) return { outcome: "not-found" as const };
      let isAssigned = false;
      if (actor.role !== "admin") {
        const [assignment] = await tx
          .select({ responsibleUserId: seriesAssignments.responsibleUserId })
          .from(seriesAssignments)
          .where(eq(seriesAssignments.seriesId, snapshot.seriesId))
          .limit(1)
          .for("update");
        isAssigned = assignment?.responsibleUserId === input.actor.userId;
      }
      const [chapter] = await tx
        .select({ seriesId: chapters.seriesId })
        .from(chapters)
        .where(eq(chapters.id, input.chapterId))
        .limit(1)
        .for("update");
      if (!chapter) return { outcome: "not-found" as const };
      if (chapter.seriesId !== snapshot.seriesId)
        return { outcome: "denied" as const };
      const reason = evaluateChapterAdministrationAuthorization({
        role: actor.role,
        isAssigned,
      });
      if (!reason) return { outcome: "denied" as const };

      const active = await tx
        .select({ permission: chapterPermissions.permission })
        .from(chapterPermissions)
        .where(
          and(
            eq(chapterPermissions.chapterId, input.chapterId),
            eq(chapterPermissions.helperUserId, input.helperUserId),
            isNull(chapterPermissions.revokedAt),
          ),
        )
        .for("update");
      if (
        active.some((row) =>
          input.permissions.includes(
            row.permission as DelegableChapterPermission,
          ),
        )
      )
        return { outcome: "conflict", reason: "already-granted" };
      if (input.cooldownDays > 0) {
        const [cooldown] = await tx
          .select({ id: helperSeriesCooldowns.id })
          .from(helperSeriesCooldowns)
          .where(
            and(
              eq(helperSeriesCooldowns.seriesId, snapshot.seriesId),
              eq(helperSeriesCooldowns.helperUserId, input.helperUserId),
              gt(helperSeriesCooldowns.expiresAt, input.now),
            ),
          )
          .limit(1)
          .for("update");
        if (cooldown) return { outcome: "conflict", reason: "cooldown" };
      }

      await tx.insert(chapterPermissions).values(
        input.permissions.map((permission) => ({
          chapterId: input.chapterId,
          helperUserId: input.helperUserId,
          permission,
          grantedBy: input.actor.userId,
          grantedAt: input.now,
        })),
      );
      await tx.insert(auditLogs).values({
        actorId: input.actor.userId,
        action: "chapter.permission.granted",
        resourceType: "chapter",
        resourceId: input.chapterId,
        metadata: sanitizeAuditMetadata({ result: "granted" }),
      });
      return { outcome: "granted", count: input.permissions.length };
    });
  }

  async revokeIfAuthorized(
    input: Parameters<ChapterPermissionRepositoryPort["revokeIfAuthorized"]>[0],
  ): ReturnType<ChapterPermissionRepositoryPort["revokeIfAuthorized"]> {
    const snapshot = await this.findById(input.chapterId);
    if (!snapshot) return { outcome: "not-found" };
    return this.db.transaction(async (tx) => {
      const actor = await lockCurrentAuthorization({
        tx,
        actor: input.actor,
        permission: PERMISSIONS.CHAPTERS_HELPER_REVOKE,
        additionalUserIds: [input.helperUserId],
      });
      if (!actor.allowed) return { outcome: "denied" as const };

      const [lockedSeries] = await tx
        .select({ id: series.id })
        .from(series)
        .where(eq(series.id, snapshot.seriesId))
        .limit(1)
        .for("update");
      if (!lockedSeries) return { outcome: "not-found" as const };
      let isAssigned = false;
      if (actor.role !== "admin") {
        const [assignment] = await tx
          .select({ responsibleUserId: seriesAssignments.responsibleUserId })
          .from(seriesAssignments)
          .where(eq(seriesAssignments.seriesId, snapshot.seriesId))
          .limit(1)
          .for("update");
        isAssigned = assignment?.responsibleUserId === input.actor.userId;
      }

      const [chapter] = await tx
        .select({ seriesId: chapters.seriesId })
        .from(chapters)
        .where(eq(chapters.id, input.chapterId))
        .limit(1)
        .for("update");
      if (!chapter) return { outcome: "not-found" as const };
      if (chapter.seriesId !== snapshot.seriesId)
        return { outcome: "denied" as const };
      const reason = evaluateChapterAdministrationAuthorization({
        role: actor.role,
        isAssigned,
      });
      if (!reason) return { outcome: "denied" as const };

      const active = await tx
        .select({ id: chapterPermissions.id })
        .from(chapterPermissions)
        .where(
          and(
            eq(chapterPermissions.chapterId, input.chapterId),
            eq(chapterPermissions.helperUserId, input.helperUserId),
            isNull(chapterPermissions.revokedAt),
          ),
        )
        .for("update");
      await tx
        .update(chapterPermissions)
        .set({ revokedAt: input.now, revokedBy: input.actor.userId })
        .where(
          and(
            eq(chapterPermissions.chapterId, input.chapterId),
            eq(chapterPermissions.helperUserId, input.helperUserId),
            isNull(chapterPermissions.revokedAt),
          ),
        );
      if (active.length > 0 && input.cooldownDays > 0) {
        const expiresAt = new Date(
          input.now.getTime() + input.cooldownDays * 86_400_000,
        );
        await tx
          .insert(helperSeriesCooldowns)
          .values({
            seriesId: snapshot.seriesId,
            helperUserId: input.helperUserId,
            startsAt: input.now,
            expiresAt,
            reason: "chapter-permission-revoked",
            sourceChapterId: input.chapterId,
            updatedAt: input.now,
          })
          .onConflictDoUpdate({
            target: [
              helperSeriesCooldowns.seriesId,
              helperSeriesCooldowns.helperUserId,
            ],
            set: {
              startsAt: input.now,
              expiresAt,
              reason: "chapter-permission-revoked",
              sourceChapterId: input.chapterId,
              updatedAt: input.now,
            },
          });
      }
      await tx.insert(auditLogs).values({
        actorId: input.actor.userId,
        action: "chapter.permission.revoked",
        resourceType: "chapter",
        resourceId: input.chapterId,
        metadata: sanitizeAuditMetadata({
          result: active.length > 0 ? "revoked" : "none",
        }),
      });
      return { outcome: "revoked" as const, count: active.length };
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

  async hasAnyActivePermission(input: {
    chapterId: string;
    helperUserId: string;
  }): Promise<boolean> {
    const [row] = await this.db
      .select({ id: chapterPermissions.id })
      .from(chapterPermissions)
      .where(
        and(
          eq(chapterPermissions.chapterId, input.chapterId),
          eq(chapterPermissions.helperUserId, input.helperUserId),
          isNull(chapterPermissions.revokedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
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

  async listActiveWithUsers(chapterId: string) {
    const rows = await this.db
      .select({
        permission: chapterPermissions,
        email: users.email,
        discordUsername: users.discordUsername,
      })
      .from(chapterPermissions)
      .innerJoin(users, eq(users.id, chapterPermissions.helperUserId))
      .where(
        and(
          eq(chapterPermissions.chapterId, chapterId),
          isNull(chapterPermissions.revokedAt),
        ),
      );
    return rows.map((row) => ({
      ...toPermission(row.permission),
      email: row.email,
      discordUsername: row.discordUsername,
    }));
  }

  async listEligibleCandidates(chapterId: string, now: Date) {
    const chapter = await this.findById(chapterId);
    if (!chapter) return [];
    const active = await this.db
      .select({
        id: users.id,
        email: users.email,
        discordUsername: users.discordUsername,
      })
      .from(users)
      .where(and(eq(users.status, "active"), eq(users.role, "uploader")));
    const granted = await this.db
      .select({ helperUserId: chapterPermissions.helperUserId })
      .from(chapterPermissions)
      .where(
        and(
          eq(chapterPermissions.chapterId, chapterId),
          isNull(chapterPermissions.revokedAt),
        ),
      );
    const cooldowns = await this.db
      .select({ helperUserId: helperSeriesCooldowns.helperUserId })
      .from(helperSeriesCooldowns)
      .where(
        and(
          eq(helperSeriesCooldowns.seriesId, chapter.seriesId),
          gt(helperSeriesCooldowns.expiresAt, now),
        ),
      );
    const unavailable = new Set([
      ...granted.map((row) => row.helperUserId),
      ...cooldowns.map((row) => row.helperUserId),
    ]);
    return active.filter((user) => !unavailable.has(user.id));
  }

  async append(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    result?: "success" | "rejected" | "failed";
    reasonCode?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      ...(input.result ? { result: input.result } : {}),
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      metadata: sanitizeAuditMetadata(input.metadata),
    });
  }
}
