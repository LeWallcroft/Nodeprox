import { and, desc, eq } from "drizzle-orm";
import type {
  NodeProxDatabase,
  NodeProxTransaction,
} from "../../../../../../../../database/client.js";
import {
  auditLogs,
  domainEventOutbox,
  series,
  seriesAssignments,
  seriesOperationalHistory,
  seriesReactivationRequests,
  users,
} from "../../../../../../../../database/schema/index.js";
import { hasSeriesActiveOperation } from "../../../../../../../../database/series-active-operation.js";
import { lockSeriesOperationalRow } from "../../../../../../../../database/series-operational-lock.js";
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
    correlationRequestId?: string,
    metadata: Record<string, unknown> = {},
  ) {
    await tx.insert(auditLogs).values({
      actorId: actor.userId,
      action,
      resourceType: "series",
      resourceId: seriesId,
      ...(correlationRequestId ? { requestId: correlationRequestId } : {}),
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
        input.correlationRequestId,
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
          input.correlationRequestId,
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
        input.correlationRequestId,
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
      const [requester] = await tx
        .select({
          email: users.email,
          displayName: users.displayName,
          discordUsername: users.discordUsername,
          discordLinkedAt: users.discordLinkedAt,
        })
        .from(users)
        .where(eq(users.id, input.actor.userId))
        .limit(1);
      const [seriesRow] = await tx
        .select({ title: series.title })
        .from(series)
        .where(eq(series.id, input.seriesId))
        .limit(1);
      const adminRows = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.status, "active")));
      const requesterLabel = requester
        ? requester.discordLinkedAt && requester.discordUsername
          ? `@${requester.discordUsername}`
          : requester.displayName?.trim() || requester.email
        : "Usuario";
      const occurredAt = new Date();
      await tx.insert(domainEventOutbox).values({
        eventType: "series.reactivation.requested",
        originRequestId: input.correlationRequestId ?? null,
        aggregateType: "series",
        aggregateId: input.seriesId,
        actorUserId: input.actor.userId,
        payload: {
          targetUserIds: adminRows.map((admin) => admin.id),
          requesterLabel: requesterLabel.slice(0, 200),
          seriesTitle: (seriesRow?.title ?? "Serie").slice(0, 200),
        },
        occurredAt,
      });
      await this.audit(
        tx,
        input.actor,
        input.seriesId,
        "series.reactivation.requested",
        input.correlationRequestId,
      );
      return {
        outcome: "requested" as const,
        reactivationRequestId: created.id,
      };
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
        .where(eq(seriesReactivationRequests.id, input.reactivationRequestId))
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
        const [assignment] = await tx
          .select({ responsibleUserId: seriesAssignments.responsibleUserId })
          .from(seriesAssignments)
          .where(eq(seriesAssignments.seriesId, input.seriesId))
          .limit(1);
        if (assignment?.responsibleUserId !== request.requestedBy) {
          await tx
            .insert(seriesAssignments)
            .values({
              seriesId: input.seriesId,
              responsibleUserId: request.requestedBy,
              assignedBy: input.actor.userId,
            })
            .onConflictDoUpdate({
              target: seriesAssignments.seriesId,
              set: {
                responsibleUserId: request.requestedBy,
                assignedBy: input.actor.userId,
                updatedAt: now,
              },
            });
          await this.audit(
            tx,
            input.actor,
            input.seriesId,
            "series.assignment.changed_on_reactivation",
            input.correlationRequestId,
            {
              reactivationRequestId: request.id,
              previousResponsibleUserId: assignment?.responsibleUserId ?? null,
              responsibleUserId: request.requestedBy,
            },
          );
        }
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
          sourceReactivationRequestId: request.id,
          ...snapshot,
          occurredAt: now,
        });
        await this.audit(
          tx,
          input.actor,
          input.seriesId,
          "series.reactivation.approved",
          input.correlationRequestId,
          { reactivationRequestId: request.id },
        );
        await this.audit(
          tx,
          input.actor,
          input.seriesId,
          "series.lifecycle.reactivated",
          input.correlationRequestId,
          { reactivationRequestId: request.id },
        );
      } else {
        await this.audit(
          tx,
          input.actor,
          input.seriesId,
          "series.reactivation.rejected",
          input.correlationRequestId,
          { reactivationRequestId: request.id },
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
        .select({
          request: seriesReactivationRequests,
          requester: {
            discordUsername: users.discordUsername,
            discordLinkedAt: users.discordLinkedAt,
            displayName: users.displayName,
            email: users.email,
          },
        })
        .from(seriesReactivationRequests)
        .innerJoin(users, eq(users.id, seriesReactivationRequests.requestedBy))
        .where(eq(seriesReactivationRequests.seriesId, seriesId))
        .orderBy(desc(seriesReactivationRequests.requestedAt))
        .then((rows) =>
          rows.map(({ request, requester }) => ({
            ...request,
            requestedByLabel:
              requester.discordLinkedAt && requester.discordUsername
                ? `@${requester.discordUsername}`
                : requester.displayName?.trim() || requester.email,
          })),
        ),
    ]);
    return { ...row, history, requests };
  }
}
