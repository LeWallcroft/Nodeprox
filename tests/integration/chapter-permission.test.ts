import { and, eq, inArray, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { DefaultAuthorizationPolicy } from "../../apps/api/src/modules/authorization/domain/policies/authorization.policy.js";
import { AuthorizationService } from "../../apps/api/src/modules/authorization/application/services/authorization.service.js";
import { DrizzleAuthorizationRepository } from "../../apps/api/src/modules/authorization/infrastructure/persistence/drizzle/authorization.repository.js";
import { DrizzleChapterRepository } from "../../apps/api/src/modules/chapters/infrastructure/persistence/drizzle/chapter.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterPermissions,
  chapters,
  series,
  systemConfig,
  users,
} from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const password = "chapter-test-password";
const ownerId = randomUUID();
const helperId = randomUUID();
const otherId = randomUUID();
const chapterId = randomUUID();
const concurrentChapterId = randomUUID();
const mixedChapterId = randomUUID();
const idempotentChapterId = randomUUID();
const cooldownChapterId = randomUUID();
const ownershipChapterId = randomUUID();
const ownerEmail = `chapter-owner-${ownerId}@example.com`;
const helperEmail = `chapter-helper-${helperId}@example.com`;
const otherEmail = `chapter-other-${otherId}@example.com`;
const hasher = new Argon2PasswordHasher();
const legacySeriesIds: string[] = [];

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

async function login(email: string): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  return cookieValue(response.headers["set-cookie"]);
}

async function insertChapter(id: string): Promise<void> {
  const seriesId = randomUUID();
  legacySeriesIds.push(seriesId);
  await database.db.insert(series).values({
    id: seriesId,
    title: `Legacy ${seriesId}`,
    slug: `legacy-${seriesId}`,
    createdBy: ownerId,
  });
  await database.db.insert(chapters).values({
    id,
    seriesId,
    chapterNumber: 1,
    createdBy: ownerId,
  });
}

const permissions = [
  "chapters.read",
  "chapters.edit",
  "chapters.replace",
  "images.upload",
  "images.replace",
  "images.reorder",
  "images.delete",
];

beforeAll(async () => {
  const passwordHash = await hasher.hash(password);
  await database.db.insert(users).values([
    {
      id: ownerId,
      email: ownerEmail,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: helperId,
      email: helperEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
    {
      id: otherId,
      email: otherEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
  await insertChapter(chapterId);
  await insertChapter(concurrentChapterId);
  await insertChapter(mixedChapterId);
  await insertChapter(idempotentChapterId);
  await insertChapter(cooldownChapterId);
  await insertChapter(ownershipChapterId);
});

afterAll(async () => {
  await database.db
    .delete(auditLogs)
    .where(eq(auditLogs.resourceId, chapterId));
  await database.db
    .delete(auditLogs)
    .where(eq(auditLogs.resourceId, concurrentChapterId));
  await database.db
    .delete(auditLogs)
    .where(eq(auditLogs.resourceId, mixedChapterId));
  await database.db.delete(chapters).where(eq(chapters.id, chapterId));
  await database.db
    .delete(chapters)
    .where(eq(chapters.id, concurrentChapterId));
  await database.db.delete(chapters).where(eq(chapters.id, mixedChapterId));
  await database.db
    .delete(chapters)
    .where(eq(chapters.id, idempotentChapterId));
  await database.db.delete(chapters).where(eq(chapters.id, cooldownChapterId));
  await database.db.delete(chapters).where(eq(chapters.id, ownershipChapterId));
  await database.db.delete(series).where(inArray(series.id, legacySeriesIds));
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, [ownerId, helperId, otherId]));
  await database.db.delete(users).where(eq(users.id, ownerId));
  await database.db.delete(users).where(eq(users.id, helperId));
  await database.db.delete(users).where(eq(users.id, otherId));
  await app.close();
  await database.sql.end();
});

describe("M2-B chapter permission authorization", () => {
  it("enforces server-side ownership for HTTP grant and revoke", async () => {
    const attackerCookie = await login(otherEmail);
    const forgedGrant = await app.inject({
      method: "POST",
      url: `/chapters/${ownershipChapterId}/permissions`,
      headers: { cookie: attackerCookie },
      payload: {
        userId: helperId,
        permissions: ["chapters.read"],
        ownerId,
        isOwner: true,
        canEdit: true,
        role: "admin",
        permission: "chapters.helper.grant",
        capability: "chapters.helper.grant",
      },
    });
    expect(forgedGrant.statusCode).toBe(422);

    const notOwnerGrant = await app.inject({
      method: "POST",
      url: `/chapters/${ownershipChapterId}/permissions`,
      headers: { cookie: attackerCookie },
      payload: { userId: helperId, permissions: ["chapters.read"] },
    });
    expect(notOwnerGrant.statusCode).toBe(403);

    const notOwnerRevoke = await app.inject({
      method: "DELETE",
      url: `/chapters/${ownershipChapterId}/permissions/${helperId}`,
      headers: { cookie: attackerCookie },
    });
    expect(notOwnerRevoke.statusCode).toBe(403);

    const ownerCookie = await login(ownerEmail);
    const ownerGrant = await app.inject({
      method: "POST",
      url: `/chapters/${ownershipChapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: helperId, permissions: ["chapters.read"] },
    });
    expect(ownerGrant.statusCode).toBe(204);

    const helperCookie = await login(helperEmail);
    const helperGrant = await app.inject({
      method: "POST",
      url: `/chapters/${ownershipChapterId}/permissions`,
      headers: { cookie: helperCookie },
      payload: { userId: otherId, permissions: ["chapters.read"] },
    });
    expect(helperGrant.statusCode).toBe(403);
    const helperRevoke = await app.inject({
      method: "DELETE",
      url: `/chapters/${ownershipChapterId}/permissions/${otherId}`,
      headers: { cookie: helperCookie },
    });
    expect(helperRevoke.statusCode).toBe(403);
  });

  it("grants only the AD-04 delegable permissions and enforces helper access", async () => {
    const ownerCookie = await login(ownerEmail);
    const grant = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: helperId, permissions },
    });
    expect(grant.statusCode).toBe(204);

    const rows = await database.db
      .select()
      .from(chapterPermissions)
      .where(eq(chapterPermissions.chapterId, chapterId));
    expect(rows).toHaveLength(7);
    expect(rows.every((row) => row.revokedAt === null)).toBe(true);
    await expect(
      database.db.insert(chapterPermissions).values({
        chapterId,
        helperUserId: helperId,
        permission: "images.process",
        grantedBy: ownerId,
      }),
    ).rejects.toThrow();
    await expect(
      database.db.insert(chapterPermissions).values({
        chapterId,
        helperUserId: helperId,
        permission: "chapters.read",
        grantedBy: ownerId,
      }),
    ).rejects.toThrow();

    const repository = new DrizzleChapterRepository(database.db);
    const authorizationRepository = new DrizzleAuthorizationRepository(
      database.db,
    );
    const service = new (
      await import(
        "../../apps/api/src/modules/chapters/application/services/chapter-permission.service.js"
      )
    ).ChapterPermissionService(
      new AuthorizationService(
        new DefaultAuthorizationPolicy(),
        authorizationRepository,
        authorizationRepository,
        authorizationRepository,
      ),
      repository,
      repository,
      repository,
      authorizationRepository,
    );
    await expect(
      service.check({
        context: { userId: helperId, sessionId: randomUUID() },
        chapterId,
        permission: "chapters.edit",
      }),
    ).resolves.toMatchObject({ allowed: true, reason: "helper" });
  });

  it("rejects excluded permissions and forged authority fields with 422", async () => {
    const ownerCookie = await login(ownerEmail);
    for (const permission of ["images.process", "images.urls.read"]) {
      const response = await app.inject({
        method: "POST",
        url: `/chapters/${chapterId}/permissions`,
        headers: { cookie: ownerCookie },
        payload: { userId: helperId, permissions: [permission] },
      });
      expect(response.statusCode).toBe(422);
    }
    const forged = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: {
        userId: helperId,
        permissions: ["chapters.read"],
        ownerId: helperId,
        isOwner: true,
        canGrant: true,
        role: "admin",
        capability: "chapters.helper.grant",
      },
    });
    expect(forged.statusCode).toBe(422);
  });

  it("rejects unauthenticated grant and revokes without physical deletion", async () => {
    const unauthenticated = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/permissions`,
      payload: { userId: otherId, permissions: ["chapters.read"] },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const ownerCookie = await login(ownerEmail);
    const revoke = await app.inject({
      method: "DELETE",
      url: `/chapters/${chapterId}/permissions/${helperId}`,
      headers: { cookie: ownerCookie },
    });
    expect(revoke.statusCode).toBe(204);
    const history = await database.db
      .select()
      .from(chapterPermissions)
      .where(eq(chapterPermissions.chapterId, chapterId));
    expect(history).toHaveLength(7);
    expect(
      history.every(
        (row) => row.revokedAt !== null && row.revokedBy === ownerId,
      ),
    ).toBe(true);
  });

  it("enforces cooldown and supports cooldown 0", async () => {
    const ownerCookie = await login(ownerEmail);
    const blocked = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: helperId, permissions: ["chapters.read"] },
    });
    expect(blocked.statusCode).toBe(409);
    await database.db
      .update(systemConfig)
      .set({ value: 0 })
      .where(eq(systemConfig.key, "helper_cooldown_days"));
    const allowed = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: helperId, permissions: ["chapters.read"] },
    });
    expect(allowed.statusCode).toBe(204);
    await database.db
      .update(systemConfig)
      .set({ value: 7 })
      .where(eq(systemConfig.key, "helper_cooldown_days"));
  });

  it("keeps sequential grant and revoke operations idempotent", async () => {
    const ownerCookie = await login(ownerEmail);
    const firstGrant = await app.inject({
      method: "POST",
      url: `/chapters/${idempotentChapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: helperId, permissions: ["chapters.read"] },
    });
    expect(firstGrant.statusCode).toBe(204);
    const repeatedGrant = await app.inject({
      method: "POST",
      url: `/chapters/${idempotentChapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: helperId, permissions: ["chapters.read"] },
    });
    expect(repeatedGrant.statusCode).toBe(409);

    const firstRevoke = await app.inject({
      method: "DELETE",
      url: `/chapters/${idempotentChapterId}/permissions/${helperId}`,
      headers: { cookie: ownerCookie },
    });
    const repeatedRevoke = await app.inject({
      method: "DELETE",
      url: `/chapters/${idempotentChapterId}/permissions/${helperId}`,
      headers: { cookie: ownerCookie },
    });
    expect(firstRevoke.statusCode).toBe(204);
    expect(repeatedRevoke.statusCode).toBe(204);
    const history = await database.db
      .select()
      .from(chapterPermissions)
      .where(eq(chapterPermissions.chapterId, idempotentChapterId));
    expect(history).toHaveLength(1);
    expect(history[0]?.revokedAt).not.toBeNull();
    expect(history.filter((row) => row.revokedAt === null)).toHaveLength(0);
  });

  it("does not bypass a positive cooldown under concurrent grants", async () => {
    const ownerCookie = await login(ownerEmail);
    const initialGrant = await app.inject({
      method: "POST",
      url: `/chapters/${cooldownChapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: helperId, permissions: ["chapters.read"] },
    });
    expect(initialGrant.statusCode).toBe(204);
    const revoke = await app.inject({
      method: "DELETE",
      url: `/chapters/${cooldownChapterId}/permissions/${helperId}`,
      headers: { cookie: ownerCookie },
    });
    expect(revoke.statusCode).toBe(204);

    const grants = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/chapters/${cooldownChapterId}/permissions`,
          headers: { cookie: ownerCookie },
          payload: { userId: helperId, permissions: ["chapters.read"] },
        }),
      ),
    );
    expect(grants.every((response) => response.statusCode === 409)).toBe(true);
    const active = await database.db
      .select()
      .from(chapterPermissions)
      .where(
        and(
          eq(chapterPermissions.chapterId, cooldownChapterId),
          isNull(chapterPermissions.revokedAt),
        ),
      );
    expect(active).toHaveLength(0);
  });

  it("serializes concurrent grants and revokes without duplicates or partial state", async () => {
    const ownerCookie = await login(ownerEmail);
    const grants = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "POST",
          url: `/chapters/${concurrentChapterId}/permissions`,
          headers: { cookie: ownerCookie },
          payload: { userId: helperId, permissions },
        }),
      ),
    );
    expect(grants.map((response) => response.statusCode).sort()).toEqual([
      204, 409,
    ]);
    const grantedRows = await database.db
      .select()
      .from(chapterPermissions)
      .where(
        and(
          eq(chapterPermissions.chapterId, concurrentChapterId),
          isNull(chapterPermissions.revokedAt),
        ),
      );
    expect(grantedRows).toHaveLength(7);

    const revokes = await Promise.all(
      [1, 2].map(() =>
        app.inject({
          method: "DELETE",
          url: `/chapters/${concurrentChapterId}/permissions/${helperId}`,
          headers: { cookie: ownerCookie },
        }),
      ),
    );
    expect(revokes.every((response) => response.statusCode === 204)).toBe(true);
    const allRows = await database.db
      .select()
      .from(chapterPermissions)
      .where(eq(chapterPermissions.chapterId, concurrentChapterId));
    expect(allRows).toHaveLength(7);
    expect(allRows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it("keeps grant/revoke races in a valid final state", async () => {
    await database.db
      .update(systemConfig)
      .set({ value: 0 })
      .where(eq(systemConfig.key, "helper_cooldown_days"));
    const ownerCookie = await login(ownerEmail);
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/chapters/${mixedChapterId}/permissions`,
        headers: { cookie: ownerCookie },
        payload: { userId: helperId, permissions },
      }),
      app.inject({
        method: "DELETE",
        url: `/chapters/${mixedChapterId}/permissions/${helperId}`,
        headers: { cookie: ownerCookie },
      }),
    ]);
    expect(responses.every((response) => response.statusCode === 204)).toBe(
      true,
    );
    const active = await database.db
      .select()
      .from(chapterPermissions)
      .where(
        and(
          eq(chapterPermissions.chapterId, mixedChapterId),
          isNull(chapterPermissions.revokedAt),
        ),
      );
    expect([0, 7]).toContain(active.length);
    await database.db
      .update(systemConfig)
      .set({ value: 7 })
      .where(eq(systemConfig.key, "helper_cooldown_days"));
  });
});
