import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
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
  },
);
const password = "ola2b-password";
const adminId = randomUUID();
const gestorId = randomUUID();
const targetId = randomUUID();
const adminEmail = `ola2b-admin-${adminId}@example.com`;
const gestorEmail = `ola2b-gestor-${gestorId}@example.com`;
const targetEmail = `ola2b-target-${targetId}@example.com`;
let adminCookie = "";
let gestorCookie = "";
let targetCookie = "";

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  const header = response.headers["set-cookie"];
  return Array.isArray(header) ? (header[0] ?? "") : (header ?? "");
}

beforeAll(async () => {
  const passwordHash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: adminId,
      email: adminEmail,
      passwordHash,
      status: "active",
      role: "admin",
    },
    {
      id: gestorId,
      email: gestorEmail,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: targetId,
      email: targetEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
  await app.ready();
  adminCookie = await login(adminEmail);
  gestorCookie = await login(gestorEmail);
  targetCookie = await login(targetEmail);
});

afterAll(async () => {
  await app.close();
  await database.sql.end();
});

describe("OLA 2B public grant administration", () => {
  it("supports bounded user lookup and rejects unauthorized actors", async () => {
    const denied = await app.inject({
      method: "GET",
      url: `/admin/users/lookup?search=${encodeURIComponent(targetEmail)}`,
      headers: { cookie: targetCookie },
    });
    expect(denied.statusCode).toBe(403);
    const response = await app.inject({
      method: "GET",
      url: `/admin/users/lookup?search=${encodeURIComponent(targetEmail)}&limit=1`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toContainEqual({
      id: targetId,
      displayName: targetEmail,
      email: targetEmail,
    });

    const gestorLookup = await app.inject({
      method: "GET",
      url: `/admin/users/lookup?search=${encodeURIComponent(targetEmail)}`,
      headers: { cookie: gestorCookie },
    });
    expect(gestorLookup.statusCode).toBe(200);
    expect(gestorLookup.json().items).toContainEqual({
      id: targetId,
      displayName: targetEmail,
      email: targetEmail,
    });
  });

  it("issues, lists, reads history, and idempotently invalidates a Web grant", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/admin/series-creation-grants",
      headers: { cookie: targetCookie },
      payload: { targetUserId: targetId },
    });
    expect(denied.statusCode).toBe(403);
    const issued = await app.inject({
      method: "POST",
      url: "/admin/series-creation-grants",
      headers: { cookie: adminCookie },
      payload: { targetUserId: targetId, reference: "campaign-2026" },
    });
    expect(issued.statusCode).toBe(201);
    const grantId = issued.json().id as string;
    const [stored] = await database.db
      .select()
      .from(seriesCreationGrants)
      .where(eq(seriesCreationGrants.id, grantId));
    expect(stored).toMatchObject({
      issuedVia: "web",
      issuedByUserId: adminId,
      issuedByDiscordId: null,
      issuedFromChannelId: null,
      issuedInteractionId: null,
    });
    expect(
      (
        await database.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.resourceId, grantId))
      ).filter((row) => row.action === "discord.series_grant.issued"),
    ).toHaveLength(1);
    expect(
      (
        await database.db
          .select()
          .from(domainEventOutbox)
          .where(eq(domainEventOutbox.aggregateId, grantId))
      ).filter((row) => row.eventType === "series.creation_grant.issued"),
    ).toHaveLength(1);
    const listed = await app.inject({
      method: "GET",
      url: "/admin/series-creation-grants?search=campaign-2026",
      headers: { cookie: adminCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      id: grantId,
      consumedAt: null,
      createdSeries: null,
    });
    const history = await app.inject({
      method: "GET",
      url: `/admin/series-creation-grants/${grantId}/history`,
      headers: { cookie: adminCookie },
    });
    expect(
      history.json().items.map((item: { type: string }) => item.type),
    ).toEqual(["issued"]);
    const first = await app.inject({
      method: "POST",
      url: `/admin/series-creation-grants/${grantId}/invalidate`,
      headers: { cookie: adminCookie },
    });
    const second = await app.inject({
      method: "POST",
      url: `/admin/series-creation-grants/${grantId}/invalidate`,
      headers: { cookie: adminCookie },
    });
    expect(first.json()).toEqual({ invalidated: true, idempotent: false });
    expect(second.json()).toEqual({ invalidated: true, idempotent: true });
    expect(
      (
        await database.db
          .select()
          .from(auditLogs)
          .where(eq(auditLogs.resourceId, grantId))
      ).filter((row) => row.action === "discord.series_grant.invalidated"),
    ).toHaveLength(1);
  });

  it("projects consumption and its authoritative Series", async () => {
    const issued = await app.inject({
      method: "POST",
      url: "/admin/series-creation-grants",
      headers: { cookie: adminCookie },
      payload: { targetUserId: targetId, reference: "consumed-projection" },
    });
    const grantId = issued.json().id as string;
    const [created] = await database.db
      .insert(series)
      .values({
        title: "Created from grant",
        slug: `created-${grantId}`,
        createdBy: targetId,
      })
      .returning();
    if (!created) throw new Error("Expected Series fixture");
    const consumedAt = new Date();
    await database.db
      .update(seriesCreationGrants)
      .set({ status: "consumed", consumedAt, consumedBySeriesId: created.id })
      .where(eq(seriesCreationGrants.id, grantId));
    const listed = await app.inject({
      method: "GET",
      url: "/admin/series-creation-grants?search=consumed-projection",
      headers: { cookie: adminCookie },
    });
    expect(listed.json().items[0]).toMatchObject({
      id: grantId,
      consumedAt: consumedAt.toISOString(),
      createdSeries: {
        id: created.id,
        title: created.title,
        slug: created.slug,
      },
    });
    const history = await app.inject({
      method: "GET",
      url: `/admin/series-creation-grants/${grantId}/history`,
      headers: { cookie: adminCookie },
    });
    expect(
      history.json().items.map((item: { type: string }) => item.type),
    ).toEqual(["issued", "consumed"]);
    const invalidation = await app.inject({
      method: "POST",
      url: `/admin/series-creation-grants/${grantId}/invalidate`,
      headers: { cookie: adminCookie },
    });
    expect(invalidation.statusCode).toBe(409);
  });
});
