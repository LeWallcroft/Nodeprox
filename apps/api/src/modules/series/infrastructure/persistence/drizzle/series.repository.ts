import { and, asc, count, eq, isNull, ne, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterPermissions,
  chapterDeletionOutbox,
  chapters,
  series,
  seriesAssignments,
} from "../../../../../../../../database/schema/index.js";
import {
  lockCurrentAuthorization,
  type NodeProxTransaction,
} from "../../../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";
import {
  PERMISSIONS,
  type Permission,
} from "../../../../authorization/domain/permissions.js";
import { evaluateChapterContextualAuthorization } from "../../../../chapters/domain/chapter-permission.policy.js";
import { evaluateChapterDelete } from "../../../../chapters/domain/chapter-delete.policy.js";
import type { AuthorizationContext } from "../../../../authorization/domain/authorization.types.js";
import type { ChapterMutationBoundaryPort } from "../../../../chapters/application/ports/chapter-mutation.ports.js";
import type {
  ChapterCoreRecord,
  SeriesRecord,
} from "../../../domain/series.types.js";
import type {
  ChapterCoreRepositoryPort,
  SeriesMutationBoundaryPort,
  SeriesRepositoryPort,
} from "../../../application/ports/series.ports.js";

const toSeries = (row: typeof series.$inferSelect): SeriesRecord => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  description: row.description,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toChapter = (row: typeof chapters.$inferSelect): ChapterCoreRecord => ({
  id: row.id,
  seriesId: row.seriesId,
  chapterNumber: row.chapterNumber,
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
  constructor(private readonly db: NodeProxDatabase) {}

  async create(input: {
    title: string;
    slug: string;
    description?: string | null | undefined;
    createdBy: string;
  }) {
    const [row] = await this.db.insert(series).values(input).returning();
    if (!row) throw new Error("series-create-failed");
    return toSeries(row);
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

  async listAssignedSeriesIds(uploaderId: string) {
    const rows = await this.db
      .select({ seriesId: seriesAssignments.seriesId })
      .from(seriesAssignments)
      .where(eq(seriesAssignments.uploaderId, uploaderId));
    return rows.map((row) => row.seriesId);
  }

  async isAssigned(seriesId: string, uploaderId: string) {
    const [row] = await this.db
      .select({ id: seriesAssignments.id })
      .from(seriesAssignments)
      .where(
        and(
          eq(seriesAssignments.seriesId, seriesId),
          eq(seriesAssignments.uploaderId, uploaderId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async assign(input: {
    seriesId: string;
    uploaderId: string;
    assignedBy: string;
  }) {
    await this.db
      .insert(seriesAssignments)
      .values(input)
      .onConflictDoUpdate({
        target: seriesAssignments.seriesId,
        set: {
          uploaderId: input.uploaderId,
          assignedBy: input.assignedBy,
          updatedAt: new Date(),
        },
      });
  }

  async clear(seriesId: string) {
    await this.db
      .delete(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, seriesId));
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
        permission: PERMISSIONS.SERIES_EDIT,
        additionalUserIds: [input.uploaderId],
      });
      if (context.outcome !== "authorized") return context;
      const target = context.usersById.get(input.uploaderId);
      if (target?.status !== "active" || target.role !== "uploader")
        return { outcome: "invalid-target" as const };
      await tx
        .insert(seriesAssignments)
        .values({
          seriesId: input.seriesId,
          uploaderId: input.uploaderId,
          assignedBy: input.actor.userId,
        })
        .onConflictDoUpdate({
          target: seriesAssignments.seriesId,
          set: {
            uploaderId: input.uploaderId,
            assignedBy: input.actor.userId,
            updatedAt: new Date(),
          },
        });
      return { outcome: "assigned" as const };
    });
  }

  async clearAssignmentIfAuthorized(
    input: Parameters<
      SeriesMutationBoundaryPort["clearAssignmentIfAuthorized"]
    >[0],
  ): ReturnType<SeriesMutationBoundaryPort["clearAssignmentIfAuthorized"]> {
    return this.db.transaction(async (tx) => {
      const context = await this.lockMutationContext({
        tx,
        actor: input.actor,
        seriesId: input.seriesId,
        permission: PERMISSIONS.SERIES_EDIT,
      });
      if (context.outcome !== "authorized") return context;
      await tx
        .delete(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, input.seriesId));
      return { outcome: "cleared" as const };
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
      .select({ uploaderId: seriesAssignments.uploaderId })
      .from(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, input.seriesId))
      .limit(1)
      .for("update");
    const reason = evaluateChapterContextualAuthorization({
      role: actor.role,
      isSeriesOwner: lockedSeries.createdBy === input.actor.userId,
      isAssigned: assignment?.uploaderId === input.actor.userId,
      hasHelperPermission: false,
    });
    return reason
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
      slug?: string | undefined;
      description?: string | null | undefined;
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
        .values({ ...input, publicKey: String(input.chapterNumber) })
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
      .set({ ...input, updatedAt: new Date() })
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
        .set({ ...input.mutation, updatedAt: new Date() })
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
        .select({ uploaderId: seriesAssignments.uploaderId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, input.expectedSeriesId))
        .limit(1)
        .for("update");
      isAssigned = assignment?.uploaderId === input.actor.userId;
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

  async isAssigned(seriesId: string, uploaderId: string) {
    return new DrizzleSeriesRepository(this.db).isAssigned(
      seriesId,
      uploaderId,
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
