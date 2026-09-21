import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import {
  auditLogs,
  discordAuthorizedRoles,
  discordIntegrations,
  discordInteractions,
  series,
  seriesCreationGrants,
  users,
} from "../../../../../../database/schema/index.js";
import type { NodeProxTransaction } from "../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";
import type { DomainEventOutbox } from "../../events/application/domain-event-outbox.js";
import {
  type DiscordBotCapability,
  hasDiscordCapability,
  mapDiscordAuthorizedRoleWrite,
  projectDiscordAuthorizedRole,
} from "./discord-authorization-policy.js";
import type { DiscordGuildRoleVerifier } from "./discord-guild-role-verifier.js";
import type {
  DiscordSeriesChannelGateway,
  SelectableSeriesChannel,
  SeriesChannelValidationResult,
} from "./discord-series-channel-gateway.js";

export type GrantStatus = "available" | "reserved" | "consumed" | "invalidated";

export class DiscordGatewayError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export const DISCORD_LINK_CHALLENGE_TTL_SECONDS = 600;

export type DiscordLinkChallengeStoreClaimResult =
  | { status: "claimed"; userId: string }
  | { status: "already_claimed_same_interaction"; userId: string }
  | { status: "claimed_by_other" }
  | { status: "not_found" };

export interface DiscordLinkChallengeStore {
  createReplacingPrevious(input: {
    userId: string;
    codeDigest: string;
    expiresAt: Date;
    ttlSeconds: number;
  }): Promise<void>;
  getActiveForUser(userId: string): Promise<{
    codeDigest: string;
    expiresAt: Date;
  } | null>;
  claim(input: {
    codeDigest: string;
    interactionId: string;
  }): Promise<DiscordLinkChallengeStoreClaimResult>;
  releaseClaim(input: {
    codeDigest: string;
    interactionId: string;
  }): Promise<void>;
  finalize(input: {
    userId: string;
    codeDigest: string;
    interactionId: string;
  }): Promise<void>;
}

export class InMemoryLinkCodeStore implements DiscordLinkChallengeStore {
  private readonly byUser = new Map<
    string,
    { codeDigest: string; expiresAt: Date }
  >();
  private readonly byDigest = new Map<
    string,
    { userId: string; claimInteractionId?: string }
  >();

  async createReplacingPrevious(input: {
    userId: string;
    codeDigest: string;
    expiresAt: Date;
    ttlSeconds: number;
  }) {
    const previous = this.byUser.get(input.userId);
    if (previous) this.byDigest.delete(previous.codeDigest);
    this.byUser.set(input.userId, {
      codeDigest: input.codeDigest,
      expiresAt: input.expiresAt,
    });
    this.byDigest.set(input.codeDigest, { userId: input.userId });
  }

  async getActiveForUser(userId: string) {
    const challenge = this.byUser.get(userId);
    if (!challenge || challenge.expiresAt <= new Date()) {
      if (challenge) {
        this.byUser.delete(userId);
        this.byDigest.delete(challenge.codeDigest);
      }
      return null;
    }
    return challenge;
  }

  async claim(input: { codeDigest: string; interactionId: string }) {
    const found = this.byDigest.get(input.codeDigest);
    if (!found) return { status: "not_found" } as const;
    const active = await this.getActiveForUser(found.userId);
    if (!active || active.codeDigest !== input.codeDigest)
      return { status: "not_found" } as const;
    if (!found.claimInteractionId) {
      found.claimInteractionId = input.interactionId;
      return { status: "claimed", userId: found.userId } as const;
    }
    if (found.claimInteractionId === input.interactionId)
      return {
        status: "already_claimed_same_interaction",
        userId: found.userId,
      } as const;
    return { status: "claimed_by_other" } as const;
  }

  async releaseClaim(input: { codeDigest: string; interactionId: string }) {
    const found = this.byDigest.get(input.codeDigest);
    if (found?.claimInteractionId === input.interactionId)
      delete found.claimInteractionId;
  }

  async finalize(input: {
    userId: string;
    codeDigest: string;
    interactionId: string;
  }) {
    const found = this.byDigest.get(input.codeDigest);
    if (
      found?.userId === input.userId &&
      found.claimInteractionId === input.interactionId
    )
      this.byDigest.delete(input.codeDigest);
    const pointer = this.byUser.get(input.userId);
    if (pointer?.codeDigest === input.codeDigest)
      this.byUser.delete(input.userId);
  }
}

const opaqueCode = (prefix: string) =>
  `${prefix}${randomBytes(9).toString("base64url").toUpperCase()}`;

const discordLinkCode = () =>
  `NPX-LINK-${randomBytes(16).toString("hex").toUpperCase()}`;

export const digestDiscordLinkCode = (code: string) =>
  createHash("sha256").update(code).digest("hex");

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

const cleanReference = (value: string | undefined) => {
  const cleaned = value?.trim().replace(/[<>]/g, "") ?? "";
  if (cleaned.length > 240) throw new DiscordGatewayError("validation-failed");
  return cleaned || null;
};

export class DiscordGatewayService {
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly links: DiscordLinkChallengeStore,
    private readonly events: DomainEventOutbox,
    private readonly bootstrap?:
      | {
          guildId: string;
          controlChannelId: string;
        }
      | undefined,
    private readonly roleVerifier?: DiscordGuildRoleVerifier,
    private readonly seriesChannelGateway?: DiscordSeriesChannelGateway,
    private readonly onChallengeFinalizeFailure: (
      error: unknown,
    ) => void = () => {},
  ) {}

  async bootstrapIntegration() {
    if (!this.bootstrap) return;
    await this.db
      .insert(discordIntegrations)
      .values(this.bootstrap)
      .onConflictDoNothing({ target: discordIntegrations.guildId });
  }

  async createLinkCode(userId: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        status: users.status,
        discordId: users.discordId,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new DiscordGatewayError("resource-not-found");
    if (user.status !== "active")
      throw new DiscordGatewayError("discord-link-user-inactive");
    if (user.discordId)
      throw new DiscordGatewayError("discord-link-already-exists");
    const code = discordLinkCode();
    const expiresAt = new Date(
      Date.now() + DISCORD_LINK_CHALLENGE_TTL_SECONDS * 1000,
    );
    await this.links.createReplacingPrevious({
      userId,
      codeDigest: digestDiscordLinkCode(code),
      expiresAt,
      ttlSeconds: DISCORD_LINK_CHALLENGE_TTL_SECONDS,
    });
    return {
      code,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds: DISCORD_LINK_CHALLENGE_TTL_SECONDS,
    };
  }

  async linkStatus(userId: string) {
    const [user] = await this.db
      .select({
        id: users.id,
        discordId: users.discordId,
        discordUsername: users.discordUsername,
        linkedAt: users.discordLinkedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw new DiscordGatewayError("resource-not-found");
    if (user.discordId)
      return {
        state: "linked" as const,
        discordId: user.discordId,
        discordUsername: user.discordUsername,
        linkedAt: user.linkedAt?.toISOString() ?? null,
      };
    const pending = await this.links.getActiveForUser(userId);
    if (pending)
      return {
        state: "pending" as const,
        expiresAt: pending.expiresAt.toISOString(),
      };
    return { state: "unlinked" as const };
  }

  async confirmLink(input: {
    code: string;
    discordId: string;
    discordUsername: string;
    guildId: string;
    channelId: string;
    interactionId: string;
    actorDiscordId: string;
  }) {
    if (input.discordId !== input.actorDiscordId)
      throw new DiscordGatewayError("validation-failed");
    const previous = await this.findSuccessfulLinkInteraction(
      input.interactionId,
    );
    if (previous) return { linked: true, idempotent: true };
    const codeDigest = digestDiscordLinkCode(input.code);
    const claim = await this.links.claim({
      codeDigest,
      interactionId: input.interactionId,
    });
    if (claim.status === "not_found")
      throw new DiscordGatewayError("discord-link-code-invalid");
    if (claim.status === "claimed_by_other")
      throw new DiscordGatewayError("discord-link-challenge-claimed");
    try {
      const result = await this.db.transaction(async (tx) => {
        await this.lockInteraction(tx, input.interactionId);
        const integration = await this.requireIntegration(
          tx,
          input.guildId,
          input.channelId,
        );
        const previousInTransaction = await this.findInteraction(
          tx,
          input.interactionId,
        );
        if (previousInTransaction) return { linked: true, idempotent: true };
        const [user] = await tx
          .select({
            id: users.id,
            status: users.status,
            discordId: users.discordId,
          })
          .from(users)
          .where(eq(users.id, claim.userId))
          .limit(1)
          .for("update");
        if (!user) throw new DiscordGatewayError("resource-not-found");
        if (user.status !== "active")
          throw new DiscordGatewayError("discord-link-user-inactive");
        if (user.discordId)
          throw new DiscordGatewayError("discord-link-already-exists");
        const [linked] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.discordId, input.discordId))
          .limit(1)
          .for("update");
        if (linked && linked.id !== user.id)
          throw new DiscordGatewayError("discord-id-already-linked");
        const [updated] = await tx
          .update(users)
          .set({
            discordId: input.discordId,
            discordUsername: input.discordUsername,
            discordLinkedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(users.id, user.id), isNull(users.discordId)))
          .returning({ id: users.id });
        if (!updated)
          throw new DiscordGatewayError("discord-link-already-exists");
        await tx.insert(discordInteractions).values({
          interactionId: input.interactionId,
          interactionType: "identity.linked",
          actorDiscordId: input.actorDiscordId,
          guildId: integration.guildId,
          channelId: input.channelId,
          result: "linked",
        });
        await tx.insert(auditLogs).values({
          actorId: user.id,
          action: "discord.identity.linked",
          resourceType: "user",
          resourceId: user.id,
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
            aggregateId: user.id,
            actorUserId: user.id,
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
      try {
        await this.links.finalize({
          userId: claim.userId,
          codeDigest,
          interactionId: input.interactionId,
        });
      } catch (error) {
        this.onChallengeFinalizeFailure(error);
      }
      return result;
    } catch (error) {
      await this.links.releaseClaim({
        codeDigest,
        interactionId: input.interactionId,
      });
      if (isUniqueViolation(error))
        throw new DiscordGatewayError("discord-id-already-linked");
      throw error;
    }
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

  async listGrantsForUser(
    userId: string,
    status?: GrantStatus,
    requiresGrant = false,
  ) {
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
    return rows.map((grant) => ({
      ...this.projectGrant(grant),
      applicable: grant.status === "available" && requiresGrant,
    }));
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

  async configuration() {
    return this.integration();
  }

  async listSelectableSeriesChannels(): Promise<
    readonly SelectableSeriesChannel[]
  > {
    await this.requireActiveIntegrationForSeriesChannels();
    if (!this.seriesChannelGateway)
      throw new DiscordGatewayError("discord-series-channels-unavailable");
    const channels = await this.seriesChannelGateway.listSelectableChannels();
    if (channels.length === 0) return channels;
    const bindings = await this.db
      .select({ discordChannelId: series.discordChannelId })
      .from(series)
      .where(
        inArray(
          series.discordChannelId,
          channels.map(({ id }) => id),
        ),
      );
    const boundChannelIds = new Set(
      bindings.flatMap(({ discordChannelId }) =>
        discordChannelId ? [discordChannelId] : [],
      ),
    );
    return channels.filter((channel) => !boundChannelIds.has(channel.id));
  }

  async validateSeriesChannel(
    channelId: string,
  ): Promise<SeriesChannelValidationResult> {
    await this.requireActiveIntegrationForSeriesChannels();
    if (!this.seriesChannelGateway)
      throw new DiscordGatewayError("discord-series-channels-unavailable");
    return this.seriesChannelGateway.validateChannel(channelId);
  }

  async replaceAuthorizedRoles(input: {
    actorDiscordId: string;
    actorRoleIds: string[];
    guildId: string;
    channelId: string;
    interactionId: string;
    roles: Array<{
      roleId: string;
      capabilities: DiscordBotCapability[];
    }>;
  }) {
    this.validateConfigurationRoles(input.guildId, input.roles);
    if (!this.roleVerifier)
      throw new DiscordGatewayError("discord-role-verification-unavailable");
    const verified = await this.roleVerifier.verifyRoles({
      guildId: input.guildId,
      roleIds: input.roles.map((role) => role.roleId),
    });
    if (
      verified.guildId !== input.guildId ||
      verified.roles.length !== input.roles.length ||
      verified.roles.some((role) => !role.exists)
    )
      throw new DiscordGatewayError("configuration-invalid-role");

    return this.db.transaction(async (tx) => {
      await this.lockInteraction(tx, input.interactionId);
      const integration = await this.requireIntegration(
        tx,
        input.guildId,
        input.channelId,
      );
      const previous = await this.findInteraction(tx, input.interactionId);
      if (previous)
        return {
          ...(await this.configurationForIntegration(
            tx,
            integration.id,
            integration.guildId,
          )),
          updatedAt: new Date().toISOString(),
        };
      await this.requireActorRole(
        tx,
        integration.id,
        input.actorRoleIds,
        "configure",
      );
      const before = await tx
        .select()
        .from(discordAuthorizedRoles)
        .where(eq(discordAuthorizedRoles.integrationId, integration.id));
      const roles = input.roles.map(mapDiscordAuthorizedRoleWrite);
      await tx
        .delete(discordAuthorizedRoles)
        .where(eq(discordAuthorizedRoles.integrationId, integration.id));
      await tx
        .insert(discordAuthorizedRoles)
        .values(
          roles.map((role) => ({ integrationId: integration.id, ...role })),
        );
      await tx.insert(discordInteractions).values({
        interactionId: input.interactionId,
        interactionType: "discord.configuration.replace-authorized-roles",
        actorDiscordId: input.actorDiscordId,
        guildId: input.guildId,
        channelId: input.channelId,
        result: integration.id,
      });
      const count = (capability: keyof (typeof roles)[number]) =>
        roles.filter((role) => role[capability]).length;
      await tx.insert(auditLogs).values({
        action: "discord.integration.config.updated",
        resourceType: "discord_integration",
        resourceId: integration.id,
        metadata: {
          actorDiscordId: input.actorDiscordId,
          guildId: input.guildId,
          interactionId: input.interactionId,
          previousRoleCount: before.length,
          newRoleCount: roles.length,
          issueCapabilityCount: count("canIssueSeriesGrants"),
          invalidateCapabilityCount: count("canInvalidateSeriesGrants"),
          configureCapabilityCount: count("canConfigureBot"),
        },
      });
      return {
        ...(await this.configurationForIntegration(
          tx,
          integration.id,
          integration.guildId,
        )),
        updatedAt: new Date().toISOString(),
      };
    });
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

  private async findSuccessfulLinkInteraction(interactionId: string) {
    const [row] = await this.db
      .select({ interactionId: discordInteractions.interactionId })
      .from(discordInteractions)
      .where(
        and(
          eq(discordInteractions.interactionId, interactionId),
          eq(discordInteractions.interactionType, "identity.linked"),
        ),
      )
      .limit(1);
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

  private async requireActiveIntegrationForSeriesChannels() {
    const [integration] = await this.db
      .select({
        id: discordIntegrations.id,
        enabled: discordIntegrations.enabled,
      })
      .from(discordIntegrations)
      .limit(1);
    if (!integration?.enabled)
      throw new DiscordGatewayError("discord-integration-disabled");
    return integration;
  }

  private async requireActorRole(
    tx: NodeProxTransaction,
    integrationId: string,
    roleIds: string[],
    action: "issue" | "invalidate" | "configure",
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
      action === "issue"
        ? "series_grant.issue"
        : action === "invalidate"
          ? "series_grant.invalidate"
          : "bot.configure";
    if (
      !hasDiscordCapability(
        roleIds,
        rows.map(projectDiscordAuthorizedRole),
        capability,
      )
    )
      throw new DiscordGatewayError("discord-actor-role-not-authorized");
  }

  private async configurationForIntegration(
    tx: NodeProxTransaction,
    integrationId: string,
    guildId: string,
  ) {
    const roles = await tx
      .select()
      .from(discordAuthorizedRoles)
      .where(eq(discordAuthorizedRoles.integrationId, integrationId));
    return {
      guildId,
      authorizedRoles: roles.map(projectDiscordAuthorizedRole),
    };
  }

  private validateConfigurationRoles(
    guildId: string,
    roles: readonly { roleId: string; capabilities: DiscordBotCapability[] }[],
  ) {
    if (!roles.length || roles.length > 100)
      throw new DiscordGatewayError("configuration-lockout");
    const seen = new Set<string>();
    for (const role of roles) {
      if (
        !/^\d{17,20}$/.test(role.roleId) ||
        role.roleId === guildId ||
        seen.has(role.roleId)
      )
        throw new DiscordGatewayError("configuration-invalid-role");
      seen.add(role.roleId);
      if (
        new Set(role.capabilities).size !== role.capabilities.length ||
        role.capabilities.some(
          (capability) =>
            ![
              "series_grant.issue",
              "series_grant.invalidate",
              "bot.configure",
            ].includes(capability),
        )
      )
        throw new DiscordGatewayError("configuration-invalid-role");
    }
    if (!roles.some((role) => role.capabilities.includes("bot.configure")))
      throw new DiscordGatewayError("configuration-lockout");
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
