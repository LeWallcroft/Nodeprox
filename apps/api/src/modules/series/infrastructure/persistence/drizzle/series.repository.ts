import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapterDeletionOutbox,
  chapterPermissions,
  chapters,
  series,
  seriesAssignments,
  seriesCreationGrants,
  users,
} from "../../../../../../../../database/schema/index.js";
import type { AuthorizationContext } from "../../../../authorization/domain/authorization.types.js";
import {
  PERMISSIONS,
  type Permission,
} from "../../../../authorization/domain/permissions.js";
import { sanitizeAuditMetadata } from "../../../../authorization/infrastructure/audit/audit-metadata.js";
import {
  lockCurrentAuthorization,
  type NodeProxTransaction,
} from "../../../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";
import type { ChapterMutationBoundaryPort } from "../../../../chapters/application/ports/chapter-mutation.ports.js";
import { evaluateChapterDelete } from "../../../../chapters/domain/chapter-delete.policy.js";
import { ChapterNumber } from "../../../../chapters/domain/chapter-number.js";
import { evaluateChapterContextualAuthorization } from "../../../../chapters/domain/chapter-permission.policy.js";
import type { DomainEventOutbox } from "../../../../events/application/domain-event-outbox.js";
import type {
  ChapterCoreRepositoryPort,
  SeriesMutationBoundaryPort,
  SeriesRepositoryPort,
} from "../../../application/ports/series.ports.js";
import { canAdministerSeries } from "../../../domain/series.policy.js";
import type {
  ChapterCoreRecord,
  SeriesRecord,
} from "../../../domain/series.types.js";
import { canBeSeriesResponsible } from "../../../domain/series-responsibility.policy.js";

const toSeries = (row: typeof series.$inferSelect): SeriesRecord => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  description: row.description,
  coverUrl: row.coverUrl,
  discordChannelId: row.discordChannelId,
  discordChannelNameSnapshot: row.discordChannelNameSnapshot,
  responsibleUser: null,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toChapter = (row: typeof chapters.$inferSelect): ChapterCoreRecord => ({
  id: row.id,
  seriesId: row.seriesId,
  chapterNumber: ChapterNumber.parse(row.chapterNumber).toNumber(),
  publicKey: row.publicKey,
  title: row.title,
  status: row.status,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class DrizzleSeriesRepository
  implements SeriesRepositoryPort, SeriesMutationBoundaryPort
{
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly events?: DomainEventOutbox,
  ) {}

  async createWithCreationPolicy(input: {
    title: string;
    slug: string;
    description?: string | null | undefined;
    coverUrl?: string | null | undefined;
    createdBy: string;
    actorRole: "admin" | "gestor" | "uploader";
    grantId?: string | undefined;
    discordChannelId?: string | undefined;
    discordChannelNameSnapshot?: string | undefined;
  }) {
    const discordChannelId = input.discordChannelId;
    if (input.actorRole === "gestor" && !discordChannelId)
      return { outcome: "channel-required" as const };
    if (input.actorRole === "uploader" && !input.grantId)
      return { outcome: "grant-not-found" as const };
    return this.db.transaction(async (tx) => {
      let grant: typeof seriesCreationGrants.$inferSelect | undefined;
      if (input.actorRole === "uploader") {
        const grantId = input.grantId;
        if (!grantId) return { outcome: "grant-not-found" as const };
        [grant] = await tx
          .select()
          .from(seriesCreationGrants)
          .where(eq(seriesCreationGrants.id, grantId))
          .limit(1)
          .for("update");
        if (!grant) return { outcome: "grant-not-found" as const };
        if (grant.targetUserId !== input.createdBy)
          return { outcome: "grant-not-owned" as const };
        if (grant.status !== "available" && grant.status !== "reserved")
          return { outcome: "grant-unavailable" as const };
      }
      const [created] = await tx
        .insert(series)
        .values({
          title: input.title,
          slug: input.slug,
          description: input.description,
          coverUrl: input.coverUrl,
          createdBy: input.createdBy,
          ...(input.actorRole === "gestor" && discordChannelId
            ? {
                discordChannelId,
                ...(input.discordChannelNameSnapshot
                  ? {
                      discordChannelNameSnapshot:
                        input.discordChannelNameSnapshot,
                    }
                  : {}),
              }
            : {}),
        })
        .returning();
      if (!created) throw new Error("series-create-failed");
      await tx.insert(seriesAssignments).values({
        seriesId: created.id,
        responsibleUserId: input.createdBy,
        assignedBy: input.createdBy,
      });
      await tx.insert(auditLogs).values({
        actorId: input.createdBy,
        action: "series.responsibility.assigned",
        resourceType: "series",
        resourceId: created.id,
        metadata: {
          responsibleUserId: input.createdBy,
          initial: true,
        },
      });
      await this.events?.append(
        {
          type: "series.responsibility.assigned",
          aggregateType: "series",
          aggregateId: created.id,
          actorUserId: input.createdBy,
          payload: { responsibleUserId: input.createdBy, initial: true },
          occurredAt: new Date(),
        },
        tx,
      );
      if (grant) {
        const [consumed] = await tx
          .update(seriesCreationGrants)
          .set({
            status: "consumed",
            consumedAt: new Date(),
            consumedBySeriesId: created.id,
          })
          .where(
            and(
              eq(seriesCreationGrants.id, grant.id),
              eq(seriesCreationGrants.status, grant.status),
            ),
          )
          .returning({ id: seriesCreationGrants.id });
        if (!consumed) throw new Error("series-creation-grant-consume-failed");
        await tx.insert(auditLogs).values({
          actorId: input.createdBy,
          action: "discord.series_grant.consumed",
          resourceType: "series_creation_grant",
          resourceId: grant.id,
          metadata: { grantId: grant.id, seriesId: created.id },
        });
        await this.events?.append(
          {
            type: "series.creation_grant.consumed",
            aggregateType: "series_creation_grant",
            aggregateId: grant.id,
            actorUserId: input.createdBy,
            payload: { grantId: grant.id, seriesId: created.id },
            occurredAt: new Date(),
          },
          tx,
        );
      }
      if (input.actorRole === "gestor")
        await tx.insert(auditLogs).values({
          actorId: input.createdBy,
          action: "series.channel.bound",
          resourceType: "series",
          resourceId: created.id,
          metadata: { channelId: input.discordChannelId },
        });
      if (input.actorRole === "gestor")
        await this.events?.append(
          {
            type: "series.channel.bound",
            aggregateType: "series",
            aggregateId: created.id,
            actorUserId: input.createdBy,
            payload: { channelId: discordChannelId },
            occurredAt: new Date(),
          },
          tx,
        );
      return { outcome: "created" as const, series: toSeries(created) };
    });
  }

  async appendAudit(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    result: "success" | "rejected" | "failed";
    reasonCode?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.db.insert(auditLogs).values({
      actorId: input.actorId,
      action: input.action,
      resourceType: input.resourceType,
      ...(input.resourceId ? { resourceId: input.resourceId } : {}),
      result: input.result,
      ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
      ...(input.requestId ? { requestId: input.requestId } : {}),
      metadata: sanitizeAuditMetadata(input.metadata),
    });
  }

  async listByOwner(ownerId: string) {
    const rows = await this.db
      .select()
      .from(series)
      .where(eq(series.createdBy, ownerId));
    return rows.map(toSeries);
  }

  async listAll() {
    const rows = await this.db.select().from(series);
    return rows.map(toSeries);
  }

  async listWithHelperAccess(userId: string) {
    const rows = await this.db
      .selectDistinct({ series })
      .from(series)
      .innerJoin(chapters, eq(chapters.seriesId, series.id))
      .innerJoin(
        chapterPermissions,
        eq(chapterPermissions.chapterId, chapters.id),
      )
      .where(
        and(
          eq(chapterPermissions.helperUserId, userId),
          isNull(chapterPermissions.revokedAt),
          ne(chapters.status, "deleting"),
        ),
      );
    return rows.map((row) => toSeries(row.series));
  }

  async hasHelperAccess(seriesId: string, userId: string) {
    const [row] = await this.db
      .select({ id: chapters.id })
      .from(chapters)
      .innerJoin(
        chapterPermissions,
        eq(chapterPermissions.chapterId, chapters.id),
      )
      .where(
        and(
          eq(chapters.seriesId, seriesId),
          eq(chapterPermissions.helperUserId, userId),
          isNull(chapterPermissions.revokedAt),
          ne(chapters.status, "deleting"),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async listAssignedSeriesIds(responsibleUserId: string) {
    const rows = await this.db
      .select({ seriesId: seriesAssignments.seriesId })
      .from(seriesAssignments)
      .where(eq(seriesAssignments.responsibleUserId, responsibleUserId));
    return rows.map((row) => row.seriesId);
  }

  async isAssigned(seriesId: string, responsibleUserId: string) {
    const [row] = await this.db
      .select({ id: seriesAssignments.id })
      .from(seriesAssignments)
      .where(
        and(
          eq(seriesAssignments.seriesId, seriesId),
          eq(seriesAssignments.responsibleUserId, responsibleUserId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async assign(input: {
    seriesId: string;
    responsibleUserId: string;
    assignedBy: string;
  }) {
    await this.db
      .insert(seriesAssignments)
      .values(input)
      .onConflictDoUpdate({
        target: seriesAssignments.seriesId,
        set: {
          responsibleUserId: input.responsibleUserId,
          assignedBy: input.assignedBy,
          updatedAt: new Date(),
        },
      });
  }

  async listResponsibleUsers(seriesIds: readonly string[]) {
    if (!seriesIds.length) return new Map();
    const rows = await this.db
      .select({
        seriesId: seriesAssignments.seriesId,
        id: users.id,
        email: users.email,
        role: users.role,
      })
      .from(seriesAssignments)
      .innerJoin(users, eq(users.id, seriesAssignments.responsibleUserId))
      .where(inArray(seriesAssignments.seriesId, [...seriesIds]));
    return new Map(
      rows.map((row) => [
        row.seriesId,
        { id: row.id, email: row.email, role: row.role },
      ]),
    );
  }

  async listActiveResponsibleCandidates() {
    const rows = await this.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
      })
      .from(users)
      .where(
        and(
          eq(users.status, "active"),
          inArray(users.role, ["admin", "gestor", "uploader"]),
        ),
      )
      .orderBy(asc(users.email));
    return rows;
  }

  async updateIfAuthorized(
    input: Parameters<SeriesMutationBoundaryPort["updateIfAuthorized"]>[0],
  ): ReturnType<SeriesMutationBoundaryPort["updateIfAuthorized"]> {
    return this.db.transaction(async (tx) => {
      const context = await this.lockMutationContext({
        tx,
        actor: input.actor,
        seriesId: input.seriesId,
        permission: PERMISSIONS.SERIES_EDIT,
      });
      if (context.outcome !== "authorized") return context;
      const [updated] = await tx
        .update(series)
        .set({ ...input.mutation, updatedAt: new Date() })
        .where(eq(series.id, input.seriesId))
        .returning();
      return updated
        ? { outcome: "updated" as const, series: toSeries(updated) }
        : { outcome: "conflict" as const };
    });
  }

  async deleteIfAuthorized(
    input: Parameters<SeriesMutationBoundaryPort["deleteIfAuthorized"]>[0],
  ): ReturnType<SeriesMutationBoundaryPort["deleteIfAuthorized"]> {
    return this.db.transaction(async (tx) => {
      const context = await this.lockMutationContext({
        tx,
        actor: input.actor,
        seriesId: input.seriesId,
        permission: PERMISSIONS.SERIES_DELETE,
      });
      if (context.outcome !== "authorized") return context;
      const [chapter] = await tx
        .select({ id: chapters.id })
        .from(chapters)
        .where(eq(chapters.seriesId, input.seriesId))
        .limit(1);
      if (chapter) return { outcome: "conflict" as const };
      const [deleted] = await tx
        .delete(series)
        .where(eq(series.id, input.seriesId))
        .returning({ id: series.id });
      return deleted
        ? { outcome: "deleted" as const }
        : { outcome: "conflict" as const };
    });
  }

  async assignIfAuthorized(
    input: Parameters<SeriesMutationBoundaryPort["assignIfAuthorized"]>[0],
  ): ReturnType<SeriesMutationBoundaryPort["assignIfAuthorized"]> {
    return this.db.transaction(async (tx) => {
      const context = await this.lockMutationContext({
        tx,
        actor: input.actor,
        seriesId: input.seriesId,
        permission: PERMISSIONS.SERIES_ASSIGNMENT_MANAGE,
        additionalUserIds: [input.responsibleUserId],
      });
      if (context.outcome !== "authorized") return context;
      const target = context.usersById.get(input.responsibleUserId);
      if (!canBeSeriesResponsible(target))
        return { outcome: "invalid-target" as const };
      const [previous] = await tx
        .select({ responsibleUserId: seriesAssignments.responsibleUserId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, input.seriesId))
        .limit(1);
      await tx
        .insert(seriesAssignments)
        .values({
          seriesId: input.seriesId,
          responsibleUserId: input.responsibleUserId,
          assignedBy: input.actor.userId,
        })
        .onConflictDoUpdate({
          target: seriesAssignments.seriesId,
          set: {
            responsibleUserId: input.responsibleUserId,
            assignedBy: input.actor.userId,
            updatedAt: new Date(),
          },
        });
      await tx.insert(auditLogs).values({
        actorId: input.actor.userId,
        action: "series.responsibility.reassigned",
        resourceType: "series",
        resourceId: input.seriesId,
        metadata: {
          previousResponsibleUserId: previous?.responsibleUserId ?? null,
          responsibleUserId: input.responsibleUserId,
        },
      });
      await this.events?.append(
        {
          type: "series.responsibility.reassigned",
          aggregateType: "series",
          aggregateId: input.seriesId,
          actorUserId: input.actor.userId,
          payload: {
            previousResponsibleUserId: previous?.responsibleUserId ?? null,
            responsibleUserId: input.responsibleUserId,
          },
          occurredAt: new Date(),
        },
        tx,
      );
      return { outcome: "assigned" as const };
    });
  }

  private async lockMutationContext(input: {
    tx: NodeProxTransaction;
    actor: AuthorizationContext;
    seriesId: string;
    permission: Permission;
    additionalUserIds?: readonly string[];
  }): Promise<
    | {
        outcome: "authorized";
        usersById: ReadonlyMap<
          string,
          { id: string; role: "admin" | "gestor" | "uploader"; status: string }
        >;
      }
    | { outcome: "denied" | "not-found" }
  > {
    const actor = await lockCurrentAuthorization({
      tx: input.tx,
      actor: input.actor,
      permission: input.permission,
      ...(input.additionalUserIds
        ? { additionalUserIds: input.additionalUserIds }
        : {}),
    });
    if (!actor.allowed) return { outcome: "denied" };
    const [lockedSeries] = await input.tx
      .select({ createdBy: series.createdBy })
      .from(series)
      .where(eq(series.id, input.seriesId))
      .limit(1)
      .for("update");
    if (!lockedSeries) return { outcome: "not-found" };
    const [assignment] = await input.tx
      .select({ responsibleUserId: seriesAssignments.responsibleUserId })
      .from(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, input.seriesId))
      .limit(1)
      .for("update");
    const allowed = canAdministerSeries({
      role: actor.role,
      isOwner: lockedSeries.createdBy === input.actor.userId,
      isAssigned: assignment?.responsibleUserId === input.actor.userId,
    });
    return allowed
      ? { outcome: "authorized", usersById: actor.usersById }
      : { outcome: "denied" };
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(series)
      .where(eq(series.id, id))
      .limit(1);
    return row ? toSeries(row) : null;
  }

  async update(
    id: string,
    input: {
      title?: string | undefined;
      description?: string | null | undefined;
      coverUrl?: string | null | undefined;
    },
  ) {
    const [row] = await this.db
      .update(series)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(series.id, id))
      .returning();
    return row ? toSeries(row) : null;
  }

  async delete(id: string) {
    await this.db.delete(series).where(eq(series.id, id));
  }

  async countChapters(id: string) {
    const [row] = await this.db
      .select({ count: count() })
      .from(chapters)
      .where(eq(chapters.seriesId, id));
    return Number(row?.count ?? 0);
  }
}

export class DrizzleChapterCoreRepository
  implements ChapterCoreRepositoryPort, ChapterMutationBoundaryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async create(input: {
    seriesId: string;
    chapterNumber: number;
    title?: string | null | undefined;
    createdBy: string;
  }) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.seriesId}, 0))`,
      );
      const [row] = await tx
        .insert(chapters)
        .values({
          ...input,
          chapterNumber: ChapterNumber.parse(input.chapterNumber).toNumber(),
          publicKey: ChapterNumber.parse(input.chapterNumber).toPublicKey(),
        })
        .returning();
      if (!row) throw new Error("chapter-create-failed");
      return toChapter(row);
    });
  }

  async listBySeries(seriesId: string) {
    const rows = await this.db
      .select()
      .from(chapters)
      .where(
        and(eq(chapters.seriesId, seriesId), ne(chapters.status, "deleting")),
      )
      .orderBy(asc(chapters.chapterNumber));
    return rows.map(toChapter);
  }

  async listBySeriesVisibleForActor(input: {
    seriesId: string;
    userId: string;
    role: "admin" | "gestor" | "uploader";
  }) {
    if (
      input.role !== "uploader" ||
      (await this.isAssigned(input.seriesId, input.userId))
    )
      return this.listBySeries(input.seriesId);
    const rows = await this.db
      .selectDistinct({ chapter: chapters })
      .from(chapters)
      .innerJoin(
        chapterPermissions,
        eq(chapterPermissions.chapterId, chapters.id),
      )
      .where(
        and(
          eq(chapters.seriesId, input.seriesId),
          eq(chapterPermissions.helperUserId, input.userId),
          isNull(chapterPermissions.revokedAt),
          ne(chapters.status, "deleting"),
        ),
      )
      .orderBy(asc(chapters.chapterNumber));
    return rows.map((row) => toChapter(row.chapter));
  }

  async listVisibleForActor(input: {
    userId: string;
    role: "admin" | "gestor" | "uploader";
  }) {
    const base = ne(chapters.status, "deleting");
    let where = base;
    if (input.role === "uploader") {
      const assigned = await this.db
        .select({ seriesId: seriesAssignments.seriesId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.responsibleUserId, input.userId));
      const delegated = await this.db
        .select({ chapterId: chapterPermissions.chapterId })
        .from(chapterPermissions)
        .where(
          and(
            eq(chapterPermissions.helperUserId, input.userId),
            isNull(chapterPermissions.revokedAt),
          ),
        );
      const conditions = [];
      if (assigned.length)
        conditions.push(
          inArray(
            chapters.seriesId,
            assigned.map((row) => row.seriesId),
          ),
        );
      if (delegated.length)
        conditions.push(
          inArray(
            chapters.id,
            delegated.map((row) => row.chapterId),
          ),
        );
      if (!conditions.length) return [];
      const visibilityCondition = and(base, or(...conditions));
      if (!visibilityCondition) return [];
      where = visibilityCondition;
    }
    const rows = await this.db
      .select({ chapter: chapters, series: series })
      .from(chapters)
      .innerJoin(series, eq(series.id, chapters.seriesId))
      .where(where)
      .orderBy(desc(chapters.updatedAt));
    return rows.map((row) => ({
      ...toChapter(row.chapter),
      series: {
        id: row.series.id,
        title: row.series.title,
        slug: row.series.slug,
        coverUrl: row.series.coverUrl,
      },
    }));
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(chapters)
      .where(eq(chapters.id, id))
      .limit(1);
    return row ? toChapter(row) : null;
  }

  async update(
    id: string,
    input: {
      chapterNumber?: number | undefined;
      title?: string | null | undefined;
    },
  ) {
    const [row] = await this.db
      .update(chapters)
      .set({
        ...input,
        ...(input.chapterNumber === undefined
          ? {}
          : {
              chapterNumber: ChapterNumber.parse(
                input.chapterNumber,
              ).toNumber(),
            }),
        updatedAt: new Date(),
      })
      .where(eq(chapters.id, id))
      .returning();
    return row ? toChapter(row) : null;
  }

  async updateIfAuthorized(
    input: Parameters<ChapterMutationBoundaryPort["updateIfAuthorized"]>[0],
  ): ReturnType<ChapterMutationBoundaryPort["updateIfAuthorized"]> {
    const snapshot = await this.findById(input.chapterId);
    if (!snapshot) return { outcome: "not-found" };
    return this.db.transaction(async (tx) => {
      const context = await this.lockMutationContext({
        tx,
        actor: input.actor,
        chapterId: input.chapterId,
        expectedSeriesId: snapshot.seriesId,
        permission: PERMISSIONS.CHAPTERS_EDIT,
        allowHelper: true,
      });
      if (context.outcome !== "authorized") return context;
      if (context.chapter.status === "deleting")
        return { outcome: "conflict" as const };
      if (
        context.chapter.chapterNumber !== input.expectedChapterNumber ||
        (input.mutation.chapterNumber !== undefined &&
          input.mutation.chapterNumber !== context.chapter.chapterNumber)
      )
        return { outcome: "conflict" as const };
      const [updated] = await tx
        .update(chapters)
        .set({
          ...input.mutation,
          ...(input.mutation.chapterNumber === undefined
            ? {}
            : {
                chapterNumber: ChapterNumber.parse(
                  input.mutation.chapterNumber,
                ).toNumber(),
              }),
          updatedAt: new Date(),
        })
        .where(eq(chapters.id, input.chapterId))
        .returning();
      return updated
        ? { outcome: "updated" as const, chapter: toChapter(updated) }
        : { outcome: "conflict" as const };
    });
  }

  async delete(id: string) {
    await this.db.delete(chapters).where(eq(chapters.id, id));
  }

  async deleteIfAuthorized(
    input: Parameters<ChapterMutationBoundaryPort["deleteIfAuthorized"]>[0],
  ): ReturnType<ChapterMutationBoundaryPort["deleteIfAuthorized"]> {
    const snapshot = await this.findById(input.chapterId);
    if (!snapshot) return { outcome: "not-found" };
    return this.db.transaction(async (tx) => {
      const context = await this.lockMutationContext({
        tx,
        actor: input.actor,
        chapterId: input.chapterId,
        expectedSeriesId: snapshot.seriesId,
        permission: PERMISSIONS.CHAPTERS_DELETE,
        allowHelper: false,
      });
      if (context.outcome !== "authorized") return context;
      const decision = evaluateChapterDelete({
        actorRole: context.role,
        permission: PERMISSIONS.CHAPTERS_DELETE,
        assigned: context.isAssigned,
        seriesOwner: context.isSeriesOwner,
      });
      if (!decision.allowed) return { outcome: "denied" as const };
      if (context.chapter.status === "deleting") {
        const [existing] = await tx
          .select({ id: chapterDeletionOutbox.id })
          .from(chapterDeletionOutbox)
          .where(eq(chapterDeletionOutbox.chapterId, input.chapterId))
          .limit(1);
        return existing
          ? {
              outcome: "deletion-requested" as const,
              deletionId: existing.id,
            }
          : { outcome: "conflict" as const };
      }
      const [marked] = await tx
        .update(chapters)
        .set({ status: "deleting", updatedAt: new Date() })
        .where(eq(chapters.id, input.chapterId))
        .returning({ id: chapters.id });
      if (!marked) return { outcome: "conflict" as const };
      const [deletion] = await tx
        .insert(chapterDeletionOutbox)
        .values({
          chapterId: input.chapterId,
          requestedBy: input.actor.userId,
        })
        .onConflictDoNothing({
          target: chapterDeletionOutbox.chapterId,
        })
        .returning({ id: chapterDeletionOutbox.id });
      if (deletion)
        return {
          outcome: "deletion-requested" as const,
          deletionId: deletion.id,
        };
      const [existing] = await tx
        .select({ id: chapterDeletionOutbox.id })
        .from(chapterDeletionOutbox)
        .where(eq(chapterDeletionOutbox.chapterId, input.chapterId))
        .limit(1);
      return existing
        ? { outcome: "deletion-requested" as const, deletionId: existing.id }
        : { outcome: "conflict" as const };
    });
  }

  private async lockMutationContext(input: {
    tx: NodeProxTransaction;
    actor: AuthorizationContext;
    chapterId: string;
    expectedSeriesId: string;
    permission: Permission;
    allowHelper: boolean;
  }): Promise<
    | {
        outcome: "authorized";
        role: "admin" | "gestor" | "uploader";
        chapter: typeof chapters.$inferSelect;
        isSeriesOwner: boolean;
        isAssigned: boolean;
      }
    | { outcome: "denied" | "not-found" | "conflict" }
  > {
    const actor = await lockCurrentAuthorization({
      tx: input.tx,
      actor: input.actor,
      permission: input.permission,
    });
    if (!actor.allowed) return { outcome: "denied" };

    let isSeriesOwner = false;
    let isAssigned = false;
    if (actor.role !== "admin") {
      const [lockedSeries] = await input.tx
        .select({ createdBy: series.createdBy })
        .from(series)
        .where(eq(series.id, input.expectedSeriesId))
        .limit(1)
        .for("update");
      if (!lockedSeries) return { outcome: "not-found" };
      isSeriesOwner = lockedSeries.createdBy === input.actor.userId;
      const [assignment] = await input.tx
        .select({ responsibleUserId: seriesAssignments.responsibleUserId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, input.expectedSeriesId))
        .limit(1)
        .for("update");
      isAssigned = assignment?.responsibleUserId === input.actor.userId;
    }

    const [chapter] = await input.tx
      .select()
      .from(chapters)
      .where(eq(chapters.id, input.chapterId))
      .limit(1)
      .for("update");
    if (!chapter) return { outcome: "not-found" };
    if (chapter.seriesId !== input.expectedSeriesId)
      return { outcome: "conflict" };

    let hasHelperPermission = false;
    if (input.allowHelper && actor.role !== "admin") {
      const [helper] = await input.tx
        .select({ id: chapterPermissions.id })
        .from(chapterPermissions)
        .where(
          and(
            eq(chapterPermissions.chapterId, input.chapterId),
            eq(chapterPermissions.helperUserId, input.actor.userId),
            eq(chapterPermissions.permission, input.permission),
            isNull(chapterPermissions.revokedAt),
          ),
        )
        .limit(1)
        .for("update");
      hasHelperPermission = Boolean(helper);
    }

    const reason = evaluateChapterContextualAuthorization({
      role: actor.role,
      isSeriesOwner,
      isAssigned,
      hasHelperPermission,
    });
    if (input.allowHelper && !reason) return { outcome: "denied" };
    return {
      outcome: "authorized",
      role: actor.role,
      chapter,
      isSeriesOwner,
      isAssigned,
    };
  }

  async isAssigned(seriesId: string, responsibleUserId: string) {
    return new DrizzleSeriesRepository(this.db).isAssigned(
      seriesId,
      responsibleUserId,
    );
  }

  async isSeriesOwner(seriesId: string, userId: string) {
    const [row] = await this.db
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.id, seriesId), eq(series.createdBy, userId)))
      .limit(1);
    return Boolean(row);
  }
}
