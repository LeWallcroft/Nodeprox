import { randomBytes } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import {
  auditLogs,
  series,
  seriesCreationGrants,
  users,
} from "../../../../../../database/schema/index.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../authorization/domain/permissions.js";
import type { DomainEventOutbox } from "../../events/application/domain-event-outbox.js";

export class WebGrantForbiddenError extends Error {}
export class WebGrantNotFoundError extends Error {}
export class WebGrantLifecycleError extends Error {}

const code = () => `NPX-SER-${randomBytes(12).toString("hex").toUpperCase()}`;

export class WebSeriesCreationGrantService {
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly authorization: AuthorizationService,
    private readonly events: DomainEventOutbox,
  ) {}
  async issue(
    actor: AuthorizationContext,
    input: { targetUserId: string; reference?: string | undefined },
  ) {
    if (
      !(
        await this.authorization.authorize(
          actor,
          PERMISSIONS.DISCORD_SERIES_GRANT_ISSUE,
        )
      ).allowed
    )
      throw new WebGrantForbiddenError();
    return this.db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: users.id, status: users.status })
        .from(users)
        .where(eq(users.id, input.targetUserId))
        .limit(1)
        .for("update");
      if (target?.status !== "active") throw new WebGrantNotFoundError();
      const [grant] = await tx
        .insert(seriesCreationGrants)
        .values({
          displayCode: code(),
          targetUserId: target.id,
          reference: input.reference?.trim() || null,
          issuedVia: "web",
          issuedByUserId: actor.userId,
        })
        .returning();
      if (!grant) throw new Error("series-creation-grant-create-failed");
      await tx.insert(auditLogs).values({
        actorId: actor.userId,
        action: "discord.series_grant.issued",
        resourceType: "series_creation_grant",
        resourceId: grant.id,
        metadata: {
          source: "web",
          targetUserId: target.id,
          reference: grant.reference,
        },
      });
      await this.events.append(
        {
          type: "series.creation_grant.issued",
          aggregateType: "series_creation_grant",
          aggregateId: grant.id,
          actorUserId: actor.userId,
          payload: {
            targetUserId: target.id,
            reference: grant.reference,
            source: "web",
          },
          occurredAt: new Date(),
        },
        tx,
      );
      return {
        id: grant.id,
        displayCode: grant.displayCode,
        status: grant.status,
        issuedAt: grant.issuedAt.toISOString(),
      };
    });
  }
  async invalidate(actor: AuthorizationContext, grantId: string) {
    if (
      !(
        await this.authorization.authorize(
          actor,
          PERMISSIONS.DISCORD_SERIES_GRANT_INVALIDATE,
        )
      ).allowed
    )
      throw new WebGrantForbiddenError();
    return this.db.transaction(async (tx) => {
      const [grant] = await tx
        .select()
        .from(seriesCreationGrants)
        .where(eq(seriesCreationGrants.id, grantId))
        .limit(1)
        .for("update");
      if (!grant) throw new WebGrantNotFoundError();
      if (grant.status === "invalidated")
        return { invalidated: true, idempotent: true };
      if (grant.status !== "available") throw new WebGrantLifecycleError();
      await tx
        .update(seriesCreationGrants)
        .set({
          status: "invalidated",
          invalidatedAt: new Date(),
          invalidatedByUserId: actor.userId,
        })
        .where(eq(seriesCreationGrants.id, grant.id));
      await tx.insert(auditLogs).values({
        actorId: actor.userId,
        action: "discord.series_grant.invalidated",
        resourceType: "series_creation_grant",
        resourceId: grant.id,
        metadata: { source: "web" },
      });
      await this.events.append(
        {
          type: "series.creation_grant.invalidated",
          aggregateType: "series_creation_grant",
          aggregateId: grant.id,
          actorUserId: actor.userId,
          payload: { source: "web" },
          occurredAt: new Date(),
        },
        tx,
      );
      return { invalidated: true, idempotent: false };
    });
  }
  async history(actor: AuthorizationContext, grantId: string) {
    if (
      !(
        await this.authorization.authorize(
          actor,
          PERMISSIONS.DISCORD_SERIES_GRANT_READ,
        )
      ).allowed
    )
      throw new WebGrantForbiddenError();
    const [grant] = await this.db
      .select({
        id: seriesCreationGrants.id,
        issuedAt: seriesCreationGrants.issuedAt,
        consumedAt: seriesCreationGrants.consumedAt,
        invalidatedAt: seriesCreationGrants.invalidatedAt,
        issuedByUserId: seriesCreationGrants.issuedByUserId,
        invalidatedByUserId: seriesCreationGrants.invalidatedByUserId,
        seriesId: series.id,
        seriesTitle: series.title,
        seriesSlug: series.slug,
      })
      .from(seriesCreationGrants)
      .leftJoin(series, eq(series.id, seriesCreationGrants.consumedBySeriesId))
      .where(eq(seriesCreationGrants.id, grantId))
      .limit(1);
    if (!grant) throw new WebGrantNotFoundError();
    const actorIds = [grant.issuedByUserId, grant.invalidatedByUserId].filter(
      (id): id is string => Boolean(id),
    );
    const actors = actorIds.length
      ? await this.db
          .select({ id: users.id, displayName: users.email })
          .from(users)
          .where(inArray(users.id, actorIds))
      : [];
    const actorReference = (id: string | null) =>
      id ? (actors.find((candidate) => candidate.id === id) ?? null) : null;
    return [
      {
        type: "issued",
        occurredAt: grant.issuedAt.toISOString(),
        actor: actorReference(grant.issuedByUserId),
        series: null,
      },
      ...(grant.consumedAt
        ? [
            {
              type: "consumed",
              occurredAt: grant.consumedAt.toISOString(),
              actor: null,
              series: grant.seriesId
                ? {
                    id: grant.seriesId,
                    title: grant.seriesTitle ?? "",
                    slug: grant.seriesSlug ?? "",
                  }
                : null,
            },
          ]
        : []),
      ...(grant.invalidatedAt
        ? [
            {
              type: "invalidated",
              occurredAt: grant.invalidatedAt.toISOString(),
              actor: actorReference(grant.invalidatedByUserId),
              series: null,
            },
          ]
        : []),
    ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  }
}
