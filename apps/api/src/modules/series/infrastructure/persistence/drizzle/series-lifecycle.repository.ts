import { and, desc, eq, isNull } from "drizzle-orm";
import type {
  NodeProxDatabase,
  NodeProxTransaction,
} from "../../../../../../../../database/client.js";
import { hasSeriesActiveOperation } from "../../../../../../../../database/series-active-operation.js";
import { lockSeriesOperationalRow } from "../../../../../../../../database/series-operational-lock.js";
import {
  auditLogs,
  chapterPermissions,
  chapters,
  series,
  seriesAssignments,
  seriesOperationalHistory,
  seriesReactivationRequests,
  users,
} from "../../../../../../../../database/schema/index.js";
import { PERMISSIONS } from "../../../../authorization/domain/permissions.js";
import { lockCurrentAuthorization } from "../../../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";
import type {
  SeriesLifecycleMutationPort,
  SeriesLifecycleQueryPort,
} from "../../../application/ports/series-lifecycle.ports.js";
import {
  evaluateSeriesDeactivation,
  evaluateSeriesReactivation,
  evaluateSeriesReactivationRequest,
} from "../../../domain/series-operational.policy.js";

type Actor = Parameters<SeriesLifecycleMutationPort["deactivate"]>[0]["actor"];

export class DrizzleSeriesLifecycleRepository
  implements SeriesLifecycleMutationPort, SeriesLifecycleQueryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  private async authorized(
    tx: NodeProxTransaction,
    actor: Actor,
    permission:
      | typeof PERMISSIONS.SERIES_LIFECYCLE_MANAGE
      | typeof PERMISSIONS.SERIES_REACTIVATION_REQUEST,
  ) {
    return lockCurrentAuthorization({ tx, actor, permission });
  }

  private async snapshot(tx: NodeProxTransaction, seriesId: string) {
    const [row] = await tx
      .select({
        userId: seriesAssignments.responsibleUserId,
        discordUsername: users.discordUsername,
        discordLinkedAt: users.discordLinkedAt,
        displayName: users.displayName,
        email: users.email,
      })
      .from(seriesAssignments)
      .innerJoin(users, eq(users.id, seriesAssignments.responsibleUserId))
      .where(eq(seriesAssignments.seriesId, seriesId))
      .for("update")
      .limit(1);
    return {
      responsibleUserIdAtEvent: row?.userId ?? null,
      responsibleLabelSnapshot: row
        ? row.discordLinkedAt && row.discordUsername
          ? `@${row.discordUsername}`
          : row.displayName?.trim() || row.email
        : null,
    };
  }

  private async audit(
    tx: NodeProxTransaction,
    actor: Actor,
    seriesId: string,
    action: string,
    requestId?: string,
    metadata: Record<string, unknown> = {},
  ) {
    await tx.insert(auditLogs).values({
      actorId: actor.userId,
      action,
      resourceType: "series",
      resourceId: seriesId,
      ...(requestId ? { requestId } : {}),
      metadata: { seriesId, ...metadata },
    });
  }

  async deactivate(
    input: Parameters<SeriesLifecycleMutationPort["deactivate"]>[0],
  ): ReturnType<SeriesLifecycleMutationPort["deactivate"]> {
    return this.db.transaction(async (tx) => {
      const actor = await this.authorized(
        tx,
        input.actor,
        PERMISSIONS.SERIES_LIFECYCLE_MANAGE,
      );
      if (!actor.allowed || actor.role !== "admin")
        return { outcome: "denied" as const };
      const locked = await lockSeriesOperationalRow(tx, input.seriesId);
      if (!locked) return { outcome: "not-found" as const };
      const decision = evaluateSeriesDeactivation({
        state: locked.operationalState,
        reason: input.reason,
        reasonDetail: input.reasonDetail,
      });
      if (!decision.allowed) return { outcome: "invalid-transition" as const };
      if (await hasSeriesActiveOperation(tx, input.seriesId))
        return { outcome: "active-operation" as const };
      const snapshot = await this.snapshot(tx, input.seriesId);
      const now = new Date();
      await tx
        .update(series)
        .set({
          operationalState: "inactive",
          inactiveReason: input.reason,
          inactiveReasonDetail: decision.reasonDetail,
          stateChangedAt: now,
          stateChangedBy: input.actor.userId,
          updatedAt: now,
        })
        .where(eq(series.id, input.seriesId));
      await tx.insert(seriesOperationalHistory).values({
        seriesId: input.seriesId,
        previousState: "active",
        nextState: "inactive",
        inactiveReason: input.reason,
        inactiveReasonDetail: decision.reasonDetail,
        actorUserId: input.actor.userId,
        ...snapshot,
        occurredAt: now,
      });
      await this.audit(
        tx,
        input.actor,
        input.seriesId,
        "series.lifecycle.deactivated",
        input.requestId,
        { reason: input.reason },
      );
      return { outcome: "deactivated" as const };
    });
  }

  async reactivate(
    input: Parameters<SeriesLifecycleMutationPort["reactivate"]>[0],
  ): ReturnType<SeriesLifecycleMutationPort["reactivate"]> {
    return this.db.transaction(async (tx) => {
      const actor = await this.authorized(
        tx,
        input.actor,
        PERMISSIONS.SERIES_LIFECYCLE_MANAGE,
      );
      if (!actor.allowed || actor.role !== "admin")
        return { outcome: "denied" as const };
      const locked = await lockSeriesOperationalRow(tx, input.seriesId);
      if (!locked) return { outcome: "not-found" as const };
      if (!evaluateSeriesReactivation(locked.operationalState).allowed)
        return { outcome: "invalid-transition" as const };
      const [previous] = await tx
        .select({
          reason: series.inactiveReason,
          detail: series.inactiveReasonDetail,
        })
        .from(series)
        .where(eq(series.id, input.seriesId));
      const [pending] = await tx
        .select({ id: seriesReactivationRequests.id })
        .from(seriesReactivationRequests)
        .where(
          and(
            eq(seriesReactivationRequests.seriesId, input.seriesId),
            eq(seriesReactivationRequests.status, "pending"),
          ),
        )
        .for("update")
        .limit(1);
      const snapshot = await this.snapshot(tx, input.seriesId);
      const now = new Date();
      await tx
        .update(series)
        .set({
          operationalState: "active",
          inactiveReason: null,
          inactiveReasonDetail: null,
          stateChangedAt: now,
          stateChangedBy: input.actor.userId,
          updatedAt: now,
        })
        .where(eq(series.id, input.seriesId));
      if (pending) {
        await tx
          .update(seriesReactivationRequests)
          .set({
            status: "cancelled",
            reviewedBy: input.actor.userId,
            reviewedAt: now,
            resolutionNote:
              input.resolutionNote?.trim() ||
              "Series reactivated directly by administrator.",
          })
          .where(eq(seriesReactivationRequests.id, pending.id));
        await this.audit(
          tx,
          input.actor,
          input.seriesId,
          "series.reactivation.cancelled",
          input.requestId,
        );
      }
      await tx.insert(seriesOperationalHistory).values({
        seriesId: input.seriesId,
        previousState: "inactive",
        nextState: "active",
        inactiveReason: previous?.reason,
        inactiveReasonDetail: previous?.detail,
        actorUserId: input.actor.userId,
        ...snapshot,
        occurredAt: now,
      });
      await this.audit(
        tx,
        input.actor,
        input.seriesId,
        "series.lifecycle.reactivated",
        input.requestId,
      );
      return { outcome: "reactivated" as const };
    });
  }

  async requestReactivation(
    input: Parameters<SeriesLifecycleMutationPort["requestReactivation"]>[0],
  ): ReturnType<SeriesLifecycleMutationPort["requestReactivation"]> {
    return this.db.transaction(async (tx) => {
      const actor = await this.authorized(
        tx,
        input.actor,
        PERMISSIONS.SERIES_REACTIVATION_REQUEST,
      );
      if (!actor.allowed || actor.role === "admin")
        return { outcome: "denied" as const };
      const locked = await lockSeriesOperationalRow(tx, input.seriesId);
      if (!locked) return { outcome: "not-found" as const };
      if (!evaluateSeriesReactivationRequest(locked.operationalState).allowed)
        return { outcome: "invalid-transition" as const };
      if (actor.role === "uploader") {
        const [assignment] = await tx
          .select({ id: seriesAssignments.id })
          .from(seriesAssignments)
          .where(
            and(
              eq(seriesAssignments.seriesId, input.seriesId),
              eq(seriesAssignments.responsibleUserId, input.actor.userId),
            ),
          )
          .limit(1);
        const [helper] = await tx
          .select({ id: chapterPermissions.id })
          .from(chapterPermissions)
          .innerJoin(chapters, eq(chapters.id, chapterPermissions.chapterId))
          .where(
            and(
              eq(chapters.seriesId, input.seriesId),
              eq(chapterPermissions.helperUserId, input.actor.userId),
              isNull(chapterPermissions.revokedAt),
            ),
          )
          .limit(1);
        if (!assignment && !helper) return { outcome: "denied" as const };
      }
      const [pending] = await tx
        .select({ id: seriesReactivationRequests.id })
        .from(seriesReactivationRequests)
        .where(
          and(
            eq(seriesReactivationRequests.seriesId, input.seriesId),
            eq(seriesReactivationRequests.status, "pending"),
          ),
        )
        .for("update")
        .limit(1);
      if (pending) return { outcome: "request-already-pending" as const };
      const [created] = await tx
        .insert(seriesReactivationRequests)
        .values({
          seriesId: input.seriesId,
          requestedBy: input.actor.userId,
          requestNote: input.note?.trim() || null,
        })
        .returning({ id: seriesReactivationRequests.id });
      if (!created) throw new Error("reactivation-request-insert-failed");
      await this.audit(
        tx,
        input.actor,
        input.seriesId,
        "series.reactivation.requested",
        input.requestId,
      );
      return { outcome: "requested" as const, requestId: created.id };
    });
  }

  async approveReactivation(
    input: Parameters<SeriesLifecycleMutationPort["approveReactivation"]>[0],
  ): ReturnType<SeriesLifecycleMutationPort["approveReactivation"]> {
    return this.review(input, true) as ReturnType<
      SeriesLifecycleMutationPort["approveReactivation"]
    >;
  }

  async rejectReactivation(
    input: Parameters<SeriesLifecycleMutationPort["rejectReactivation"]>[0],
  ): ReturnType<SeriesLifecycleMutationPort["rejectReactivation"]> {
    return this.review(input, false) as ReturnType<
      SeriesLifecycleMutationPort["rejectReactivation"]
    >;
  }

  private async review(
    input: Parameters<SeriesLifecycleMutationPort["approveReactivation"]>[0],
    approve: boolean,
  ) {
    return this.db.transaction(async (tx) => {
      const actor = await this.authorized(
        tx,
        input.actor,
        PERMISSIONS.SERIES_LIFECYCLE_MANAGE,
      );
      if (!actor.allowed || actor.role !== "admin")
        return { outcome: "denied" as const };
      const locked = await lockSeriesOperationalRow(tx, input.seriesId);
      if (!locked) return { outcome: "not-found" as const };
      const [request] = await tx
        .select()
        .from(seriesReactivationRequests)
        .where(eq(seriesReactivationRequests.id, input.requestId))
        .for("update")
        .limit(1);
      if (!request || request.seriesId !== input.seriesId)
        return { outcome: "request-not-found" as const };
      if (
        request.status !== "pending" ||
        locked.operationalState !== "inactive"
      )
        return { outcome: "request-invalid-state" as const };
      const now = new Date();
      await tx
        .update(seriesReactivationRequests)
        .set({
          status: approve ? "approved" : "rejected",
          reviewedBy: input.actor.userId,
          reviewedAt: now,
          resolutionNote: input.resolutionNote?.trim() || null,
        })
        .where(eq(seriesReactivationRequests.id, request.id));
      if (approve) {
        const [previous] = await tx
          .select({
            reason: series.inactiveReason,
            detail: series.inactiveReasonDetail,
          })
          .from(series)
          .where(eq(series.id, input.seriesId));
        const snapshot = await this.snapshot(tx, input.seriesId);
        await tx
          .update(series)
          .set({
            operationalState: "active",
            inactiveReason: null,
            inactiveReasonDetail: null,
            stateChangedAt: now,
            stateChangedBy: input.actor.userId,
            updatedAt: now,
          })
          .where(eq(series.id, input.seriesId));
        await tx.insert(seriesOperationalHistory).values({
          seriesId: input.seriesId,
          previousState: "inactive",
          nextState: "active",
          inactiveReason: previous?.reason,
          inactiveReasonDetail: previous?.detail,
          actorUserId: input.actor.userId,
          sourceRequestId: request.id,
          ...snapshot,
          occurredAt: now,
        });
        await this.audit(
          tx,
          input.actor,
          input.seriesId,
          "series.reactivation.approved",
        );
        await this.audit(
          tx,
          input.actor,
          input.seriesId,
          "series.lifecycle.reactivated",
        );
      } else {
        await this.audit(
          tx,
          input.actor,
          input.seriesId,
          "series.reactivation.rejected",
        );
      }
      return {
        outcome: approve ? ("approved" as const) : ("rejected" as const),
      };
    });
  }

  async getLifecycleDetail(seriesId: string) {
    const [row] = await this.db
      .select({
        operationalState: series.operationalState,
        inactiveReason: series.inactiveReason,
        inactiveReasonDetail: series.inactiveReasonDetail,
        stateChangedAt: series.stateChangedAt,
        stateChangedBy: series.stateChangedBy,
      })
      .from(series)
      .where(eq(series.id, seriesId))
      .limit(1);
    if (!row) return null;
    const [history, requests] = await Promise.all([
      this.db
        .select()
        .from(seriesOperationalHistory)
        .where(eq(seriesOperationalHistory.seriesId, seriesId))
        .orderBy(desc(seriesOperationalHistory.occurredAt)),
      this.db
        .select()
        .from(seriesReactivationRequests)
        .where(eq(seriesReactivationRequests.seriesId, seriesId))
        .orderBy(desc(seriesReactivationRequests.requestedAt)),
    ]);
    return { ...row, history, requests };
  }
}
