import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { DiscordProfileSyncCoordinator } from "../../apps/api/src/modules/discord/application/discord-profile-sync.coordinator.js";
import { SyncDiscordUserProfilesService } from "../../apps/api/src/modules/discord/application/sync-discord-user-profiles.service.js";
import { DrizzleDiscordIdentityLinkRepository } from "../../apps/api/src/modules/discord/infrastructure/persistence/drizzle/discord-identity-link.repository.js";
import { DrizzleDiscordProfileRepository } from "../../apps/api/src/modules/discord/infrastructure/persistence/drizzle/discord-profile.repository.js";
import { PostgresDiscordProfileSyncLease } from "../../apps/api/src/modules/discord/infrastructure/postgres/postgres-discord-profile-sync.lease.js";
import { createDatabase } from "../../database/client.js";
import { auditLogs, users } from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const profileRepository = new DrizzleDiscordProfileRepository(database.db);
const userIds = Array.from({ length: 5 }, () => randomUUID()) as [
  string,
  string,
  string,
  string,
  string,
];
const [adminId, unlinkedId, neverSyncedId, freshId, linkId] = userIds;
const emails = userIds.map((id) => `discord-sync-${id}@example.com`) as [
  string,
  string,
  string,
  string,
  string,
];
const password = "discord-profile-sync-integration-password";
const profileSystem = {
  repository: profileRepository,
  runner: { setLogger: vi.fn() },
  coordinator: {
    isRunningDistributed: vi.fn().mockResolvedValue(false),
    trigger: vi.fn().mockResolvedValue({ accepted: true }),
    waitForIdle: vi.fn().mockResolvedValue(undefined),
    setLogger: vi.fn(),
  },
  config: {
    DISCORD_PROFILE_SYNC_INTERVAL_MS: 3_600_000,
    DISCORD_PROFILE_SYNC_BATCH_SIZE: 200,
    DISCORD_PROFILE_SYNC_CONCURRENCY: 5,
  },
};
const app = buildApp(
  { logger: false },
  {
    database: database.db,
    secureCookie: false,
    discordProfileSync: profileSystem as never,
  },
);
const cutoff = new Date("2026-10-12T00:00:00.000Z");
const oldSync = new Date("2026-10-11T22:00:00.000Z");
const freshSync = new Date("2026-10-12T01:00:00.000Z");
const [adminDiscordId, neverSyncedDiscordId, freshDiscordId, changedDiscordId] =
  [
    "10000000000000001",
    "10000000000000002",
    "10000000000000003",
    "10000000000000004",
  ] as [string, string, string, string];

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  const cookie = response.headers["set-cookie"];
  return Array.isArray(cookie) ? cookie[0] : cookie;
}

beforeAll(async () => {
  await app.ready();
  const passwordHash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: adminId,
      email: emails[0],
      passwordHash,
      status: "active",
      role: "admin",
      discordId: adminDiscordId,
      discordUsername: "old_name",
      avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
      discordProfileSyncedAt: oldSync,
      updatedAt: oldSync,
    },
    {
      id: unlinkedId,
      email: emails[1],
      passwordHash,
      status: "active",
      role: "uploader",
    },
    {
      id: neverSyncedId,
      email: emails[2],
      passwordHash,
      status: "active",
      role: "uploader",
      discordId: neverSyncedDiscordId,
      discordUsername: "never_synced",
      avatarUrl: "https://cdn.discordapp.com/embed/avatars/2.png",
    },
    {
      id: freshId,
      email: emails[3],
      passwordHash,
      status: "active",
      role: "uploader",
      discordId: freshDiscordId,
      discordUsername: "fresh_name",
      avatarUrl: null,
      discordProfileSyncedAt: freshSync,
      updatedAt: freshSync,
    },
  ]);
});

afterAll(async () => {
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, userIds));
  await database.db.delete(users).where(inArray(users.id, userIds));
  await app.close();
  await database.sql.end();
});

describe("Discord profile projection synchronization", () => {
  it("has the nullable sync timestamp migration column", async () => {
    const columns = await database.sql`
      select is_nullable from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
        and column_name = 'discord_profile_synced_at'
    `;
    expect(columns).toHaveLength(1);
    expect(columns[0]?.is_nullable).toBe("YES");
  });

  it("selects linked stale and never-synced users, excludes fresh and unlinked users", async () => {
    const stale = await profileRepository.listLinked({
      limit: 100,
      staleBefore: cutoff,
    });
    const staleIds = stale.map((row) => row.userId);
    expect(staleIds).toContain(userIds[0]);
    expect(staleIds).toContain(userIds[2]);
    expect(staleIds).not.toContain(userIds[1]);
    expect(staleIds).not.toContain(userIds[3]);

    const forced = await profileRepository.listLinked({ limit: 100 });
    const forcedIds = forced.map((row) => row.userId);
    expect(forcedIds).toContain(userIds[0]);
    expect(forcedIds).toContain(userIds[2]);
    expect(forcedIds).toContain(userIds[3]);
    expect(forcedIds).not.toContain(userIds[1]);
  });

  it("advances freshness without changing updatedAt, then reports changed projections", async () => {
    const nextSync = new Date("2026-10-12T01:00:00.000Z");
    await expect(
      profileRepository.updateDiscordProfile({
        userId: adminId,
        expectedDiscordId: adminDiscordId,
        discordUsername: "old_name",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/1.png",
        syncedAt: nextSync,
      }),
    ).resolves.toBe("refreshed");
    let [stored] = await database.db
      .select({
        updatedAt: users.updatedAt,
        syncedAt: users.discordProfileSyncedAt,
      })
      .from(users)
      .where(inArray(users.id, [adminId]))
      .limit(1);
    expect(stored?.updatedAt).toEqual(oldSync);
    expect(stored?.syncedAt).toEqual(nextSync);

    const changedAt = new Date("2026-10-12T02:00:00.000Z");
    await expect(
      profileRepository.updateDiscordProfile({
        userId: adminId,
        expectedDiscordId: adminDiscordId,
        discordUsername: "new_name",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/3.png",
        syncedAt: changedAt,
      }),
    ).resolves.toBe("changed");
    [stored] = await database.db
      .select({
        username: users.discordUsername,
        avatarUrl: users.avatarUrl,
        updatedAt: users.updatedAt,
        syncedAt: users.discordProfileSyncedAt,
      })
      .from(users)
      .where(inArray(users.id, [adminId]))
      .limit(1);
    expect(stored).toMatchObject({
      username: "new_name",
      avatarUrl: "https://cdn.discordapp.com/embed/avatars/3.png",
      updatedAt: changedAt,
      syncedAt: changedAt,
    });
  });

  it("uses indexed identity lookup for targeted refresh and preserves a linked profile on provider failure", async () => {
    expect(
      await profileRepository.findLinkedByDiscordId(adminDiscordId),
    ).toEqual({
      userId: adminId,
      discordId: adminDiscordId,
    });
    expect(
      await profileRepository.findLinkedByDiscordId("99999999999999999"),
    ).toBeNull();
    const getProfile = vi
      .fn()
      .mockResolvedValueOnce({
        id: adminDiscordId,
        username: "targeted_name",
        avatarUrl: "https://cdn.discordapp.com/embed/avatars/4.png",
      })
      .mockResolvedValueOnce(null);
    const service = new SyncDiscordUserProfilesService(profileRepository, {
      getProfile,
    });
    expect(await service.syncLinkedProfileByDiscordId(adminDiscordId)).toBe(
      "changed",
    );
    expect(getProfile).toHaveBeenCalledWith(adminDiscordId, { force: true });
    expect(await service.syncLinkedProfileByDiscordId(adminDiscordId)).toBe(
      "unavailable",
    );
    const [stored] = await database.db
      .select({
        discordId: users.discordId,
        discordUsername: users.discordUsername,
        avatarUrl: users.avatarUrl,
      })
      .from(users)
      .where(inArray(users.id, [adminId]))
      .limit(1);
    expect(stored).toEqual({
      discordId: adminDiscordId,
      discordUsername: "targeted_name",
      avatarUrl: "https://cdn.discordapp.com/embed/avatars/4.png",
    });
  });

  it("does not overwrite a profile after the Discord link changes", async () => {
    await database.db
      .update(users)
      .set({ discordId: changedDiscordId, discordUsername: "new_link" })
      .where(inArray(users.id, [adminId]))
      .returning();
    await expect(
      profileRepository.updateDiscordProfile({
        userId: adminId,
        expectedDiscordId: adminDiscordId,
        discordUsername: "stale_provider_name",
        avatarUrl: null,
        syncedAt: new Date(),
      }),
    ).resolves.toBe("link-changed");
    const [stored] = await database.db
      .select({
        discordId: users.discordId,
        discordUsername: users.discordUsername,
      })
      .from(users)
      .where(inArray(users.id, [adminId]))
      .limit(1);
    expect(stored).toMatchObject({
      discordId: changedDiscordId,
      discordUsername: "new_link",
    });
  });

  it("uses the same-connection PostgreSQL advisory lease", async () => {
    const first = new PostgresDiscordProfileSyncLease(database.sql);
    const second = new PostgresDiscordProfileSyncLease(database.sql);
    const handle = await first.tryAcquire();
    expect(handle).not.toBeNull();
    await expect(first.isHeld()).resolves.toBe(true);
    await expect(second.isHeld()).resolves.toBe(true);
    const secondCoordinator = new DiscordProfileSyncCoordinator(
      second,
      { run: vi.fn() } as never,
      { batchSize: 200, concurrency: 5 },
    );
    await expect(secondCoordinator.isRunningDistributed()).resolves.toBe(true);
    await expect(second.tryAcquire()).resolves.toBeNull();
    await handle?.release();
    await expect(second.isHeld()).resolves.toBe(false);
    await expect(secondCoordinator.isRunningDistributed()).resolves.toBe(false);
    const nextHandle = await second.tryAcquire();
    expect(nextHandle).not.toBeNull();
    await nextHandle?.release();
  });

  it("protects Discord profile sync with server-side authorization and request audit", async () => {
    const anonymousStatus = await app.inject({
      method: "GET",
      url: "/admin/discord/profile-sync",
    });
    const anonymousTrigger = await app.inject({
      method: "POST",
      url: "/admin/discord/profile-sync",
    });
    expect(anonymousStatus.statusCode).toBe(401);
    expect(anonymousTrigger.statusCode).toBe(401);

    await expect(
      app.inject({ method: "GET", url: "/admin/maintenance/discord-profiles" }),
    ).resolves.toMatchObject({ statusCode: 404 });
    await expect(
      app.inject({
        method: "POST",
        url: "/admin/maintenance/discord-profiles/sync",
      }),
    ).resolves.toMatchObject({ statusCode: 404 });

    const uploaderCookie = await login(emails[1]);
    const forbidden = await app.inject({
      method: "GET",
      url: "/admin/discord/profile-sync",
      headers: { cookie: uploaderCookie },
    });
    expect(forbidden.statusCode).toBe(403);

    const adminCookie = await login(emails[0]);
    const status = await app.inject({
      method: "GET",
      url: "/admin/discord/profile-sync",
      headers: { cookie: adminCookie },
    });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({ syncRunning: false });

    const invalidBody = await app.inject({
      method: "POST",
      url: "/admin/discord/profile-sync",
      headers: { cookie: adminCookie },
      payload: { discordId: adminDiscordId, avatarUrl: "https://evil.test/a" },
    });
    expect(invalidBody.statusCode).toBe(422);

    const accepted = await app.inject({
      method: "POST",
      url: "/admin/discord/profile-sync",
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(accepted.statusCode, accepted.body).toBe(202);
    expect(accepted.json()).toEqual({ accepted: true });
    expect(profileSystem.coordinator.trigger).toHaveBeenCalledWith({
      mode: "force",
    });
    const requestId = accepted.headers["x-request-id"];
    const audit = await database.db
      .select({
        requestId: auditLogs.requestId,
        action: auditLogs.action,
        result: auditLogs.result,
        reasonCode: auditLogs.reasonCode,
      })
      .from(auditLogs)
      .where(inArray(auditLogs.actorId, [adminId]))
      .limit(1);
    expect(audit).toContainEqual({
      requestId,
      action: "discord.profile_sync.triggered",
      result: "success",
      reasonCode: null,
    });

    profileSystem.coordinator.trigger.mockResolvedValueOnce({
      accepted: false,
      reason: "already-running",
    });
    const concurrent = await app.inject({
      method: "POST",
      url: "/admin/discord/profile-sync",
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(concurrent.statusCode).toBe(202);
    expect(concurrent.json()).toEqual({
      accepted: false,
      reason: "already-running",
    });
    const rejectedAudit = await database.db
      .select({ result: auditLogs.result, reasonCode: auditLogs.reasonCode })
      .from(auditLogs)
      .where(inArray(auditLogs.actorId, [adminId]));
    expect(rejectedAudit).toContainEqual({
      result: "rejected",
      reasonCode: "already-running",
    });
  });

  it("stores link-time profile freshness with the identity projection", async () => {
    const linkUserId = linkId;
    await database.db.insert(users).values({
      id: linkUserId,
      email: emails[4],
      passwordHash: "unused-hash",
      status: "active",
      role: "uploader",
    });
    const syncedAt = new Date("2026-10-12T03:00:00.000Z");
    const linkRepository = new DrizzleDiscordIdentityLinkRepository();
    await database.db.transaction(async (tx) => {
      await linkRepository.updateDiscordIdentity({
        tx,
        userId: linkUserId,
        discordId: "10000000000000005",
        discordUsername: "linked_user",
        discordAvatarUrl: "https://cdn.discordapp.com/embed/avatars/4.png",
        syncedAt,
      });
    });
    const [linked] = await database.db
      .select({
        discordId: users.discordId,
        discordLinkedAt: users.discordLinkedAt,
        discordProfileSyncedAt: users.discordProfileSyncedAt,
      })
      .from(users)
      .where(inArray(users.id, [linkUserId]))
      .limit(1);
    expect(linked).toMatchObject({
      discordId: "10000000000000005",
      discordLinkedAt: syncedAt,
      discordProfileSyncedAt: syncedAt,
    });
  });
});
