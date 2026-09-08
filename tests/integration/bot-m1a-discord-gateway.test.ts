import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  discordAuthorizedRoles,
  discordIntegrations,
  domainEventOutbox,
  series,
  seriesCreationGrants,
  users,
} from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
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
let integrationId = "";

async function login() {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
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
  const hasher = new Argon2PasswordHasher();
  await database.db.insert(users).values({
    id: userId,
    email,
    passwordHash: await hasher.hash(password),
    status: "active",
    role: "uploader",
    discordId: "discord-target",
  });
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
  await database.db.delete(users).where(eq(users.id, userId));
  await database.sql.end();
});

describe("BOT-M1A internal Discord gateway", () => {
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
