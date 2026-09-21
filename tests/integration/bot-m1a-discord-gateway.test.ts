import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { digestDiscordLinkCode } from "../../apps/api/src/modules/discord/application/discord-gateway.service.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  discordAuthorizedRoles,
  discordIntegrations,
  discordInteractions,
  domainEventOutbox,
  series,
  seriesCreationGrants,
  users,
} from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const redis = createClient({ url: infrastructure.redisUrl });
const app = buildApp(
  { logger: false },
  {
    database: database.db,
    secureCookie: false,
    storage: { provider: "filesystem", uploadMaxSizeBytes: 1024 },
    discord: {
      internalToken: "test-internal-token",
      redisUrl: infrastructure.redisUrl,
      guildId: "guild-1",
      controlChannelId: "channel-1",
    },
  },
);
const password = "bot-m1a-password";
const userId = randomUUID();
const email = `bot-m1a-${userId}@example.com`;
const linkUserId = randomUUID();
const linkEmail = `bot-m2b-link-${linkUserId}@example.com`;
const duplicateLinkUserId = randomUUID();
const duplicateLinkEmail = `bot-m2b-duplicate-${duplicateLinkUserId}@example.com`;
let integrationId = "";

async function login() {
  return loginAs(email, password);
}

async function loginAs(loginEmail: string, loginPassword: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: loginEmail, password: loginPassword },
  });
  expect(response.statusCode).toBe(204);
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? header[0] : header;
}

function issuePayload(interactionId: string = randomUUID()) {
  return {
    targetDiscordId: "discord-target",
    reference: "Approved title",
    actorDiscordId: "discord-actor",
    actorRoleIds: ["role-issuer"],
    guildId: "guild-1",
    channelId: "channel-1",
    interactionId,
  };
}

beforeAll(async () => {
  await app.ready();
  await redis.connect();
  const hasher = new Argon2PasswordHasher();
  await database.db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hasher.hash(password),
    status: "active",
    role: "uploader",
    discordId: "discord-target",
  });
  await database.db.insert(users).values([
    {
      id: linkUserId,
      email: linkEmail,
      passwordHash: await hasher.hash(password),
      status: "active",
      role: "uploader",
    },
    {
      id: duplicateLinkUserId,
      email: duplicateLinkEmail,
      passwordHash: await hasher.hash(password),
      status: "active",
      role: "uploader",
    },
  ]);
  const [integration] = await database.db
    .select()
    .from(discordIntegrations)
    .where(eq(discordIntegrations.guildId, "guild-1"));
  if (!integration) throw new Error("missing integration bootstrap");
  integrationId = integration.id;
  await database.db.insert(discordAuthorizedRoles).values({
    integrationId,
    roleId: "role-issuer",
    canIssueSeriesGrants: true,
    canInvalidateSeriesGrants: true,
  });
});

afterAll(async () => {
  await app.close();
  await database.db
    .delete(seriesCreationGrants)
    .where(eq(seriesCreationGrants.targetUserId, userId));
  await database.db.delete(series).where(eq(series.createdBy, userId));
  await database.db
    .delete(discordAuthorizedRoles)
    .where(eq(discordAuthorizedRoles.integrationId, integrationId));
  await database.db
    .delete(discordIntegrations)
    .where(eq(discordIntegrations.id, integrationId));
  await database.db
    .delete(domainEventOutbox)
    .where(eq(domainEventOutbox.actorUserId, userId));
  await database.db.delete(auditLogs).where(eq(auditLogs.actorId, userId));
  await database.db.delete(auditLogs).where(eq(auditLogs.actorId, linkUserId));
  await database.db
    .delete(auditLogs)
    .where(eq(auditLogs.actorId, duplicateLinkUserId));
  await database.db
    .delete(domainEventOutbox)
    .where(eq(domainEventOutbox.actorUserId, linkUserId));
  await database.db
    .delete(domainEventOutbox)
    .where(eq(domainEventOutbox.actorUserId, duplicateLinkUserId));
  await database.db
    .delete(discordInteractions)
    .where(eq(discordInteractions.actorDiscordId, "discord-link-user"));
  await database.db.delete(users).where(eq(users.id, userId));
  await database.db.delete(users).where(eq(users.id, linkUserId));
  await database.db.delete(users).where(eq(users.id, duplicateLinkUserId));
  await database.sql.end();
  await redis.quit();
});

describe("BOT-M1A internal Discord gateway", () => {
  it("keeps link challenges private, supersedes them, and links idempotently", async () => {
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/me/discord-link",
    });
    expect(unauthenticated.statusCode).toBe(401);
    const cookie = await loginAs(linkEmail, password);
    const first = await app.inject({
      method: "POST",
      url: "/me/discord/link-code",
      headers: { cookie },
    });
    const second = await app.inject({
      method: "POST",
      url: "/me/discord/link-code",
      headers: { cookie },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().code).not.toBe(second.json().code);
    expect(second.json()).toEqual(
      expect.objectContaining({
        expiresAt: expect.any(String),
        expiresInSeconds: 600,
      }),
    );
    expect(
      await redis.get(`nodeprox:discord-link:code:${second.json().code}`),
    ).toBeNull();
    expect(
      await redis.get(
        `nodeprox:discord-link:code:${digestDiscordLinkCode(second.json().code)}`,
      ),
    ).toContain(linkUserId);
    expect(
      await redis.ttl(`nodeprox:discord-link:user:${linkUserId}`),
    ).toBeGreaterThan(0);
    expect(
      await redis.ttl(
        `nodeprox:discord-link:code:${digestDiscordLinkCode(second.json().code)}`,
      ),
    ).toBeGreaterThan(0);
    const pending = await app.inject({
      method: "GET",
      url: "/me/discord-link",
      headers: { cookie },
    });
    expect(pending.json()).toEqual({
      state: "pending",
      expiresAt: expect.any(String),
    });
    expect(pending.body).not.toContain(second.json().code);
    const expiredBySupersession = await app.inject({
      method: "POST",
      url: "/internal/discord/confirm-link",
      headers: { authorization: "Bearer test-internal-token" },
      payload: {
        code: first.json().code,
        discordId: "discord-link-user",
        discordUsername: "Discord Link User",
        actorDiscordId: "discord-link-user",
        guildId: "guild-1",
        channelId: "channel-1",
        interactionId: "link-superseded",
      },
    });
    expect(expiredBySupersession.statusCode).toBe(400);
    const confirmation = {
      code: second.json().code as string,
      discordId: "discord-link-user",
      discordUsername: "Discord Link User",
      actorDiscordId: "discord-link-user",
      guildId: "guild-1",
      channelId: "channel-1",
      interactionId: "link-idempotent",
    };
    const wrongChannel = await app.inject({
      method: "POST",
      url: "/internal/discord/confirm-link",
      headers: { authorization: "Bearer test-internal-token" },
      payload: {
        ...confirmation,
        interactionId: "link-wrong-channel",
        channelId: "wrong-channel",
      },
    });
    expect(wrongChannel.statusCode).toBe(403);
    const linked = await app.inject({
      method: "POST",
      url: "/internal/discord/confirm-link",
      headers: { authorization: "Bearer test-internal-token" },
      payload: confirmation,
    });
    const retry = await app.inject({
      method: "POST",
      url: "/internal/discord/confirm-link",
      headers: { authorization: "Bearer test-internal-token" },
      payload: confirmation,
    });
    expect(linked.statusCode).toBe(200);
    expect(retry.json()).toEqual({ linked: true, idempotent: true });
    await redis.set(
      `nodeprox:discord-link:user:${linkUserId}`,
      JSON.stringify({
        codeDigest: "residual-digest",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      { EX: 60 },
    );
    const status = await app.inject({
      method: "GET",
      url: "/me/discord-link",
      headers: { cookie },
    });
    expect(status.json()).toEqual({
      state: "linked",
      discordId: "discord-link-user",
      discordUsername: "Discord Link User",
      linkedAt: expect.any(String),
    });
    const audits = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, linkUserId));
    expect(
      audits.filter((entry) => entry.action === "discord.identity.linked"),
    ).toHaveLength(1);
    const events = await database.db
      .select()
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.aggregateId, linkUserId));
    expect(
      events.filter((entry) => entry.eventType === "discord.identity.linked"),
    ).toHaveLength(1);
  });

  it("does not replace an existing NodeProx link or a linked Discord identity", async () => {
    const linkedCookie = await loginAs(linkEmail, password);
    const alreadyLinked = await app.inject({
      method: "POST",
      url: "/me/discord/link-code",
      headers: { cookie: linkedCookie },
    });
    expect(alreadyLinked.statusCode).toBe(409);
    const duplicateCookie = await loginAs(duplicateLinkEmail, password);
    const challenge = await app.inject({
      method: "POST",
      url: "/me/discord/link-code",
      headers: { cookie: duplicateCookie },
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/internal/discord/confirm-link",
      headers: { authorization: "Bearer test-internal-token" },
      payload: {
        code: challenge.json().code,
        discordId: "discord-link-user",
        discordUsername: "Discord Link User",
        actorDiscordId: "discord-link-user",
        guildId: "guild-1",
        channelId: "channel-1",
        interactionId: "link-duplicate-identity",
      },
    });
    expect(duplicate.statusCode).toBe(409);
    const [original] = await database.db
      .select({ discordId: users.discordId })
      .from(users)
      .where(eq(users.id, linkUserId));
    expect(original?.discordId).toBe("discord-link-user");
  });
  it("requires the M2M credential", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/internal/discord/series-grants",
      payload: issuePayload(),
    });
    expect(response.statusCode).toBe(401);
  });

  it("issues exactly one grant for a repeated Discord interaction", async () => {
    const payload = issuePayload("interaction-issue-idempotent");
    const first = await app.inject({
      method: "POST",
      url: "/internal/discord/series-grants",
      headers: { authorization: "Bearer test-internal-token" },
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/internal/discord/series-grants",
      headers: { authorization: "Bearer test-internal-token" },
      payload,
    });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    const rows = await database.db
      .select()
      .from(seriesCreationGrants)
      .where(
        eq(seriesCreationGrants.issuedInteractionId, payload.interactionId),
      );
    expect(rows).toHaveLength(1);
    const events = await database.db
      .select()
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.aggregateId, first.json().id));
    expect(events).toEqual([
      expect.objectContaining({ eventType: "series.creation_grant.issued" }),
    ]);
    const audits = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, first.json().id));
    expect(audits).toEqual([
      expect.objectContaining({ action: "discord.series_grant.issued" }),
    ]);
  });

  it("atomically consumes one owned grant during uploader series creation", async () => {
    const issued = await app.inject({
      method: "POST",
      url: "/internal/discord/series-grants",
      headers: { authorization: "Bearer test-internal-token" },
      payload: issuePayload("interaction-concurrency"),
    });
    const cookie = await login();
    const grantId = issued.json().id as string;
    const [first, second] = await Promise.all([
      app.inject({
        method: "POST",
        url: "/series",
        headers: { cookie },
        payload: { title: `M1A ${randomUUID()}`, grantId },
      }),
      app.inject({
        method: "POST",
        url: "/series",
        headers: { cookie },
        payload: { title: `M1A ${randomUUID()}`, grantId },
      }),
    ]);
    expect(
      [first.statusCode, second.statusCode].filter((status) => status === 201),
    ).toHaveLength(1);
    expect(
      [first.statusCode, second.statusCode].some((status) => status === 409),
    ).toBe(true);
    const grants = await database.db
      .select()
      .from(seriesCreationGrants)
      .where(
        and(
          eq(seriesCreationGrants.id, grantId),
          eq(seriesCreationGrants.status, "consumed"),
        ),
      );
    expect(grants).toHaveLength(1);
    const events = await database.db
      .select()
      .from(domainEventOutbox)
      .where(
        and(
          eq(domainEventOutbox.aggregateId, grantId),
          eq(domainEventOutbox.eventType, "series.creation_grant.consumed"),
        ),
      );
    expect(events).toHaveLength(1);
  });

  it("rolls back the Series consumption event when Series creation fails", async () => {
    const title = `Atomic collision ${randomUUID()}`;
    await database.db.insert(series).values({
      title,
      slug: title.toLowerCase().replaceAll(" ", "-"),
      createdBy: userId,
    });
    const issued = await app.inject({
      method: "POST",
      url: "/internal/discord/series-grants",
      headers: { authorization: "Bearer test-internal-token" },
      payload: issuePayload("interaction-rollback"),
    });
    const grantId = issued.json().id as string;
    const cookie = await login();
    const response = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie },
      payload: { title, grantId },
    });
    expect(response.statusCode).toBe(409);
    const [grant] = await database.db
      .select()
      .from(seriesCreationGrants)
      .where(eq(seriesCreationGrants.id, grantId));
    expect(grant?.status).toBe("available");
    const events = await database.db
      .select()
      .from(domainEventOutbox)
      .where(
        and(
          eq(domainEventOutbox.aggregateId, grantId),
          eq(domainEventOutbox.eventType, "series.creation_grant.consumed"),
        ),
      );
    expect(events).toHaveLength(0);
  });
});
