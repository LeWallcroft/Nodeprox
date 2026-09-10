import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import {
  auditLogs,
  discordAuthorizedRoles,
  discordIntegrations,
  discordInteractions,
  seriesCreationGrants,
  users,
} from "../../../../../../database/schema/index.js";
import type { NodeProxTransaction } from "../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";
import type { DomainEventOutbox } from "../../events/application/domain-event-outbox.js";
import {
  hasDiscordCapability,
  projectDiscordAuthorizedRole,
  type DiscordBotCapability,
} from "./discord-authorization-policy.js";

export type GrantStatus = "available" | "reserved" | "consumed" | "invalidated";

export class DiscordGatewayError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface LinkCodeStore {
  create(userId: string, code: string, ttlSeconds: number): Promise<void>;
  consume(code: string): Promise<string | null>;
}

export class InMemoryLinkCodeStore implements LinkCodeStore {
  private readonly values = new Map<
    string,
    { userId: string; expiresAt: number }
  >();
  async create(userId: string, code: string, ttlSeconds: number) {
    this.values.set(code, {
      userId,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }
  async consume(code: string) {
    const found = this.values.get(code);
    this.values.delete(code);
    return found && found.expiresAt > Date.now() ? found.userId : null;
  }
}

const opaqueCode = (prefix: string) =>
  `${prefix}${randomBytes(9).toString("base64url").toUpperCase()}`;

const cleanReference = (value: string | undefined) => {
  const cleaned = value?.trim().replace(/[<>]/g, "") ?? "";
  if (cleaned.length > 240) throw new DiscordGatewayError("validation-failed");
  return cleaned || null;
};

export class DiscordGatewayService {
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly links: LinkCodeStore,
    private readonly events: DomainEventOutbox,
    private readonly bootstrap?:
      | {
          guildId: string;
          controlChannelId: string;
        }
      | undefined,
  ) {}

  async bootstrapIntegration() {
    if (!this.bootstrap) return;
    await this.db
      .insert(discordIntegrations)
      .values(this.bootstrap)
      .onConflictDoNothing({ target: discordIntegrations.guildId });
  }

  async createLinkCode(userId: string) {
    const code = opaqueCode("NPX-LINK-");
    await this.links.create(userId, code, 600);
    return { code, expiresInSeconds: 600 };
  }

  async confirmLink(input: {
    code: string;
    discordId: string;
    guildId: string;
    channelId: string;
    interactionId: string;
    actorDiscordId: string;
  }) {
    const userId = await this.links.consume(input.code);
    if (!userId) throw new DiscordGatewayError("discord-link-code-invalid");
    return this.db.transaction(async (tx) => {
      await this.lockInteraction(tx, input.interactionId);
      const integration = await this.requireIntegration(
        tx,
        input.guildId,
        input.channelId,
      );
      const previous = await this.findInteraction(tx, input.interactionId);
      if (previous) return { linked: true, idempotent: true };
      const [linked] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.discordId, input.discordId))
        .limit(1)
        .for("update");
      if (linked && linked.id !== userId)
        throw new DiscordGatewayError("discord-id-already-linked");
      const [updated] = await tx
        .update(users)
        .set({
          discordId: input.discordId,
          discordLinkedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId))
        .returning({ id: users.id });
      if (!updated) throw new DiscordGatewayError("resource-not-found");
      await tx.insert(discordInteractions).values({
        interactionId: input.interactionId,
        interactionType: "identity.linked",
        actorDiscordId: input.actorDiscordId,
        guildId: integration.guildId,
        channelId: input.channelId,
        result: "linked",
      });
      await tx.insert(auditLogs).values({
        actorId: userId,
        action: "discord.identity.linked",
        resourceType: "user",
        resourceId: userId,
        metadata: {
          actorDiscordId: input.actorDiscordId,
          guildId: input.guildId,
          channelId: input.channelId,
        },
      });
      await this.events.append(
        {
          type: "discord.identity.linked",
          aggregateType: "user",
          aggregateId: userId,
          actorUserId: userId,
          payload: {
            actorDiscordId: input.actorDiscordId,
            guildId: input.guildId,
            channelId: input.channelId,
          },
          occurredAt: new Date(),
        },
        tx,
      );
      return { linked: true, idempotent: false };
    });
  }

  async issueGrant(input: {
    targetDiscordId: string;
    reference?: string | undefined;
    actorDiscordId: string;
    actorRoleIds: string[];
    guildId: string;
    channelId: string;
    interactionId: string;
  }) {
    return this.db.transaction(async (tx) => {
      await this.lockInteraction(tx, input.interactionId);
      const integration = await this.requireIntegration(
        tx,
        input.guildId,
        input.channelId,
      );
      const previous = await this.findInteraction(tx, input.interactionId);
      if (previous) {
        const [grant] = await tx
          .select()
          .from(seriesCreationGrants)
          .where(
            eq(seriesCreationGrants.issuedInteractionId, input.interactionId),
          )
          .limit(1);
        if (!grant)
          throw new DiscordGatewayError(
            "discord-interaction-already-processed",
          );
        return this.projectGrant(grant);
      }
      await this.requireActorRole(
        tx,
        integration.id,
        input.actorRoleIds,
        "issue",
      );
      const [target] = await tx
        .select({ id: users.id, email: users.email, status: users.status })
        .from(users)
        .where(eq(users.discordId, input.targetDiscordId))
        .limit(1)
        .for("update");
      if (target?.status !== "active")
        throw new DiscordGatewayError("discord-not-linked");
      const [grant] = await tx
        .insert(seriesCreationGrants)
        .values({
          displayCode: opaqueCode("NPX-SER-"),
          targetUserId: target.id,
          reference: cleanReference(input.reference),
          issuedByDiscordId: input.actorDiscordId,
          issuedFromChannelId: input.channelId,
          issuedInteractionId: input.interactionId,
        })
        .returning();
      if (!grant) throw new Error("series-creation-grant-create-failed");
      await tx.insert(discordInteractions).values({
        interactionId: input.interactionId,
        interactionType: "series-grant.issue",
        actorDiscordId: input.actorDiscordId,
        guildId: input.guildId,
        channelId: input.channelId,
        result: grant.id,
      });
      await tx.insert(auditLogs).values({
        action: "discord.series_grant.issued",
        resourceType: "series_creation_grant",
        resourceId: grant.id,
        metadata: {
          actorDiscordId: input.actorDiscordId,
          targetUserId: target.id,
          guildId: input.guildId,
          channelId: input.channelId,
          reference: grant.reference,
        },
      });
      await this.events.append(
        {
          type: "series.creation_grant.issued",
          aggregateType: "series_creation_grant",
          aggregateId: grant.id,
          payload: {
            targetUserId: target.id,
            actorDiscordId: input.actorDiscordId,
            guildId: input.guildId,
            channelId: input.channelId,
            reference: grant.reference,
          },
          occurredAt: new Date(),
        },
        tx,
      );
      return {
        ...this.projectGrant(grant),
        targetUser: { id: target.id, username: target.email },
      };
    });
  }

  async invalidateGrant(input: {
    grantId: string;
    actorDiscordId: string;
    actorRoleIds: string[];
    guildId: string;
    channelId: string;
    interactionId: string;
  }) {
    return this.db.transaction(async (tx) => {
      await this.lockInteraction(tx, input.interactionId);
      const integration = await this.requireIntegration(
        tx,
        input.guildId,
        input.channelId,
      );
      const previous = await this.findInteraction(tx, input.interactionId);
      if (previous) return { invalidated: true, idempotent: true };
      await this.requireActorRole(
        tx,
        integration.id,
        input.actorRoleIds,
        "invalidate",
      );
      const [grant] = await tx
        .select()
        .from(seriesCreationGrants)
        .where(eq(seriesCreationGrants.id, input.grantId))
        .limit(1)
        .for("update");
      if (!grant)
        throw new DiscordGatewayError("series-creation-grant-not-found");
      if (grant.status !== "available")
        throw new DiscordGatewayError("series-creation-grant-invalidated");
      await tx
        .update(seriesCreationGrants)
        .set({
          status: "invalidated",
          invalidatedAt: new Date(),
          invalidatedByDiscordId: input.actorDiscordId,
          invalidatedInteractionId: input.interactionId,
        })
        .where(eq(seriesCreationGrants.id, input.grantId));
      await tx.insert(discordInteractions).values({
        interactionId: input.interactionId,
        interactionType: "series-grant.invalidate",
        actorDiscordId: input.actorDiscordId,
        guildId: input.guildId,
        channelId: input.channelId,
        result: input.grantId,
      });
      await tx.insert(auditLogs).values({
        action: "discord.series_grant.invalidated",
        resourceType: "series_creation_grant",
        resourceId: input.grantId,
        metadata: {
          actorDiscordId: input.actorDiscordId,
          guildId: input.guildId,
          channelId: input.channelId,
        },
      });
      await this.events.append(
        {
          type: "series.creation_grant.invalidated",
          aggregateType: "series_creation_grant",
          aggregateId: input.grantId,
          payload: {
            actorDiscordId: input.actorDiscordId,
            guildId: input.guildId,
            channelId: input.channelId,
          },
          occurredAt: new Date(),
        },
        tx,
      );
      return { invalidated: true, idempotent: false };
    });
  }

  async listGrantsForUser(userId: string, status?: GrantStatus) {
    const rows = await this.db
      .select()
      .from(seriesCreationGrants)
      .where(
        status
          ? and(
              eq(seriesCreationGrants.targetUserId, userId),
              eq(seriesCreationGrants.status, status),
            )
          : eq(seriesCreationGrants.targetUserId, userId),
      );
    return rows.map((grant) => this.projectGrant(grant));
  }

  async integration() {
    const [integration] = await this.db
      .select()
      .from(discordIntegrations)
      .limit(1);
    if (!integration)
      throw new DiscordGatewayError("discord-integration-disabled");
    const roles = await this.db
      .select()
      .from(discordAuthorizedRoles)
      .where(eq(discordAuthorizedRoles.integrationId, integration.id));
    return {
      guildId: integration.guildId,
      controlChannelId: integration.controlChannelId,
      enabled: integration.enabled,
      authorizedRoles: roles.map(projectDiscordAuthorizedRole),
    };
  }

  private projectGrant(grant: typeof seriesCreationGrants.$inferSelect) {
    return {
      id: grant.id,
      displayCode: grant.displayCode,
      reference: grant.reference,
      status: grant.status,
      issuedAt: grant.issuedAt.toISOString(),
    };
  }

  private async findInteraction(
    tx: NodeProxTransaction,
    interactionId: string,
  ) {
    const [row] = await tx
      .select({ interactionId: discordInteractions.interactionId })
      .from(discordInteractions)
      .where(eq(discordInteractions.interactionId, interactionId))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  private async lockInteraction(
    tx: NodeProxTransaction,
    interactionId: string,
  ) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${interactionId}, 0))`,
    );
  }

  private async requireIntegration(
    tx: NodeProxTransaction,
    guildId: string,
    channelId: string,
  ) {
    const [integration] = await tx
      .select()
      .from(discordIntegrations)
      .where(eq(discordIntegrations.guildId, guildId))
      .limit(1)
      .for("update");
    if (!integration?.enabled)
      throw new DiscordGatewayError("discord-integration-disabled");
    if (integration.controlChannelId !== channelId)
      throw new DiscordGatewayError("discord-control-channel-required");
    return integration;
  }

  private async requireActorRole(
    tx: NodeProxTransaction,
    integrationId: string,
    roleIds: string[],
    action: "issue" | "invalidate",
  ) {
    if (!roleIds.length)
      throw new DiscordGatewayError("discord-actor-role-not-authorized");
    const rows = await tx
      .select()
      .from(discordAuthorizedRoles)
      .where(
        and(
          eq(discordAuthorizedRoles.integrationId, integrationId),
          inArray(discordAuthorizedRoles.roleId, roleIds),
        ),
      );
    const capability: DiscordBotCapability =
      action === "issue" ? "series_grant.issue" : "series_grant.invalidate";
    if (
      !hasDiscordCapability(
        roleIds,
        rows.map(projectDiscordAuthorizedRole),
        capability,
      )
    )
      throw new DiscordGatewayError("discord-actor-role-not-authorized");
  }
}

export function matchesInternalToken(
  provided: string | undefined,
  expected: string | undefined,
) {
  if (!provided || !expected) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
