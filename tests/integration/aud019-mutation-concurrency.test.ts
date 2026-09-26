import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
} from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterDeletionOutbox,
  chapters,
  series,
  seriesAssignments,
  users,
} from "../../database/schema/index.js";
import {
  FakeDiscordSeriesChannelGateway,
  withM2DSeriesFixtures,
} from "./helpers/discord-series-channel-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = withM2DSeriesFixtures(
  buildApp(
    { logger: false },
    {
      database: database.db,
      secureCookie: false,
      seriesChannelGateway: new FakeDiscordSeriesChannelGateway(),
      storage: { provider: "filesystem", uploadMaxSizeBytes: 1024 },
    },
  ),
);
const password = "aud019-concurrency-password";
const hasher = new Argon2PasswordHasher();
const ownerId = randomUUID();
const adminId = randomUUID();
const uploaderId = randomUUID();
const replacementId = randomUUID();
const helperId = randomUUID();
const actorIds = [ownerId, adminId, uploaderId, replacementId, helperId];
const emails = {
  owner: `aud019-owner-${ownerId}@example.com`,
  admin: `aud019-admin-${adminId}@example.com`,
  uploader: `aud019-uploader-${uploaderId}@example.com`,
  replacement: `aud019-replacement-${replacementId}@example.com`,
  helper: `aud019-helper-${helperId}@example.com`,
};
let ownerCookie: string;
let adminCookie: string;
let uploaderCookie: string;
let helperCookie: string;

type SqlTransaction = postgres.TransactionSql;

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

async function createSeriesOnly(label: string) {
  const createdSeries = await app.inject({
    method: "POST",
    url: "/series",
    headers: { cookie: ownerCookie },
    payload: {
      title: `AUD-019 ${label}`,
      slug: `aud019-${label}-${randomUUID()}`,
    },
  });
  expect(createdSeries.statusCode).toBe(201);
  return createdSeries.json().id as string;
}

async function createSeriesWithChapter(label: string) {
  const seriesId = await createSeriesOnly(label);
  const createdChapter = await app.inject({
    method: "POST",
    url: `/series/${seriesId}/chapters`,
    headers: { cookie: ownerCookie },
    payload: { chapterNumber: 1, title: "original" },
  });
  expect(createdChapter.statusCode).toBe(201);
  return { seriesId, chapterId: createdChapter.json().id as string };
}

async function assign(seriesId: string, responsibleUserId: string) {
  return app.inject({
    method: "PUT",
    url: `/series/${seriesId}/responsible`,
    headers: { cookie: ownerCookie },
    payload: { responsibleUserId },
  });
}

async function returnResponsibilityToOwner(seriesId: string) {
  return assign(seriesId, ownerId);
}

async function patchChapter(chapterId: string, cookie: string, title: string) {
  return app.inject({
    method: "PATCH",
    url: `/chapters/${chapterId}`,
    headers: { cookie },
    payload: { title },
  });
}

async function deleteChapter(chapterId: string, cookie: string) {
  return app.inject({
    method: "DELETE",
    url: `/chapters/${chapterId}`,
    headers: { cookie },
  });
}

const activeBlockers = new Set<{
  release: () => void;
  done: Promise<unknown>;
}>();

function startBlocker(lock: (tx: SqlTransaction) => Promise<unknown>) {
  let ready!: () => void;
  let release!: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = database.sql.begin(async (tx) => {
    await lock(tx);
    ready();
    await held;
  });
  const blocker = { ready: readyPromise, release, done };
  activeBlockers.add(blocker);
  void done.finally(() => activeBlockers.delete(blocker));
  return blocker;
}

async function waitForBlockedQuery(tableName: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  const pattern = `%${tableName}%`;
  while (Date.now() < deadline) {
    const [row] = await database.sql<{ waiting: boolean }[]>`
      select exists (
        select 1
        from pg_stat_activity
        where wait_event_type = 'Lock'
          and query ilike ${pattern}
      ) as waiting
    `;
    if (row?.waiting) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${tableName} lock`);
}

async function chapterState(chapterId: string) {
  const [chapter] = await database.db
    .select({ title: chapters.title, status: chapters.status })
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  return chapter ?? null;
}

beforeAll(async () => {
  const passwordHash = await hasher.hash(password);
  await database.db.insert(users).values([
    {
      id: ownerId,
      email: emails.owner,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: adminId,
      email: emails.admin,
      passwordHash,
      status: "active",
      role: "admin",
    },
    {
      id: uploaderId,
      email: emails.uploader,
      passwordHash,
      status: "active",
      role: "uploader",
    },
    {
      id: replacementId,
      email: emails.replacement,
      passwordHash,
      status: "active",
      role: "uploader",
    },
    {
      id: helperId,
      email: emails.helper,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
  ownerCookie = await login(emails.owner);
  adminCookie = await login(emails.admin);
  uploaderCookie = await login(emails.uploader);
  helperCookie = await login(emails.helper);
});

afterEach(async () => {
  const blockers = [...activeBlockers];
  for (const blocker of blockers) blocker.release();
  await Promise.allSettled(blockers.map((blocker) => blocker.done));
  await database.db
    .update(users)
    .set({ status: "active", updatedAt: new Date() })
    .where(inArray(users.id, [ownerId, adminId]));
});

afterAll(async () => {
  await database.db
    .delete(chapterDeletionOutbox)
    .where(inArray(chapterDeletionOutbox.requestedBy, actorIds));
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, actorIds));
  await database.db
    .delete(chapters)
    .where(inArray(chapters.createdBy, actorIds));
  await database.db.delete(series).where(inArray(series.createdBy, actorIds));
  await database.db.delete(users).where(inArray(users.id, actorIds));
  await app.close();
  await database.sql.end();
});

describe("AUD-019 transactional mutation authorization", () => {
  it("serializes Chapter update against assignment revocation in both commit orders", async () => {
    const revocationWins = await createSeriesWithChapter("update-revoke-first");
    expect((await assign(revocationWins.seriesId, uploaderId)).statusCode).toBe(
      200,
    );
    const sessionBlocker = startBlocker(
      (tx) =>
        tx`select id from sessions where user_id = ${uploaderId} for update`,
    );
    await sessionBlocker.ready;
    const deniedUpdate = patchChapter(
      revocationWins.chapterId,
      uploaderCookie,
      "must-not-commit",
    );
    await waitForBlockedQuery("sessions");
    expect(
      (await returnResponsibilityToOwner(revocationWins.seriesId)).statusCode,
    ).toBe(200);
    sessionBlocker.release();
    await sessionBlocker.done;
    expect((await deniedUpdate).statusCode).toBe(403);
    expect((await chapterState(revocationWins.chapterId))?.title).toBe(
      "original",
    );

    const mutationWins = await createSeriesWithChapter("update-mutation-first");
    expect((await assign(mutationWins.seriesId, uploaderId)).statusCode).toBe(
      200,
    );
    const chapterBlocker = startBlocker(
      (tx) =>
        tx`select id from chapters where id = ${mutationWins.chapterId} for update`,
    );
    await chapterBlocker.ready;
    const acceptedUpdate = patchChapter(
      mutationWins.chapterId,
      uploaderCookie,
      "mutation-won",
    );
    await waitForBlockedQuery("chapters");
    const laterRevocation = returnResponsibilityToOwner(mutationWins.seriesId);
    await waitForBlockedQuery("series");
    chapterBlocker.release();
    await chapterBlocker.done;
    expect((await acceptedUpdate).statusCode).toBe(200);
    expect((await laterRevocation).statusCode).toBe(200);
    expect((await chapterState(mutationWins.chapterId))?.title).toBe(
      "mutation-won",
    );
  });

  it("serializes Chapter update against reassignment in both commit orders", async () => {
    const reassignmentWins = await createSeriesWithChapter(
      "update-reassign-first",
    );
    expect(
      (await assign(reassignmentWins.seriesId, uploaderId)).statusCode,
    ).toBe(200);
    const sessionBlocker = startBlocker(
      (tx) =>
        tx`select id from sessions where user_id = ${uploaderId} for update`,
    );
    await sessionBlocker.ready;
    const deniedUpdate = patchChapter(
      reassignmentWins.chapterId,
      uploaderCookie,
      "stale-assignment",
    );
    await waitForBlockedQuery("sessions");
    expect(
      (await assign(reassignmentWins.seriesId, replacementId)).statusCode,
    ).toBe(200);
    sessionBlocker.release();
    await sessionBlocker.done;
    expect((await deniedUpdate).statusCode).toBe(403);
    expect((await chapterState(reassignmentWins.chapterId))?.title).toBe(
      "original",
    );

    const mutationWins = await createSeriesWithChapter(
      "update-before-reassign",
    );
    expect((await assign(mutationWins.seriesId, uploaderId)).statusCode).toBe(
      200,
    );
    const chapterBlocker = startBlocker(
      (tx) =>
        tx`select id from chapters where id = ${mutationWins.chapterId} for update`,
    );
    await chapterBlocker.ready;
    const acceptedUpdate = patchChapter(
      mutationWins.chapterId,
      uploaderCookie,
      "before-reassignment",
    );
    await waitForBlockedQuery("chapters");
    const laterReassignment = assign(mutationWins.seriesId, replacementId);
    await waitForBlockedQuery("series");
    chapterBlocker.release();
    await chapterBlocker.done;
    expect((await acceptedUpdate).statusCode).toBe(200);
    expect((await laterReassignment).statusCode).toBe(200);
    expect((await chapterState(mutationWins.chapterId))?.title).toBe(
      "before-reassignment",
    );
  });

  it("serializes Chapter delete against assignment revocation in both commit orders", async () => {
    const revocationWins = await createSeriesWithChapter("delete-revoke-first");
    expect((await assign(revocationWins.seriesId, uploaderId)).statusCode).toBe(
      200,
    );
    const sessionBlocker = startBlocker(
      (tx) =>
        tx`select id from sessions where user_id = ${uploaderId} for update`,
    );
    await sessionBlocker.ready;
    const deniedDelete = deleteChapter(
      revocationWins.chapterId,
      uploaderCookie,
    );
    await waitForBlockedQuery("sessions");
    expect(
      (await returnResponsibilityToOwner(revocationWins.seriesId)).statusCode,
    ).toBe(200);
    sessionBlocker.release();
    await sessionBlocker.done;
    expect((await deniedDelete).statusCode).toBe(403);
    expect(await chapterState(revocationWins.chapterId)).not.toBeNull();

    const mutationWins = await createSeriesWithChapter("delete-mutation-first");
    expect((await assign(mutationWins.seriesId, uploaderId)).statusCode).toBe(
      200,
    );
    const chapterBlocker = startBlocker(
      (tx) =>
        tx`select id from chapters where id = ${mutationWins.chapterId} for update`,
    );
    await chapterBlocker.ready;
    const acceptedDelete = deleteChapter(
      mutationWins.chapterId,
      uploaderCookie,
    );
    await waitForBlockedQuery("chapters");
    const laterRevocation = returnResponsibilityToOwner(mutationWins.seriesId);
    await waitForBlockedQuery("series");
    chapterBlocker.release();
    await chapterBlocker.done;
    expect((await acceptedDelete).statusCode).toBe(204);
    expect((await laterRevocation).statusCode).toBe(200);
    expect(await chapterState(mutationWins.chapterId)).toMatchObject({
      status: "deleting",
    });
  });

  it("serializes Chapter delete against reassignment in both commit orders", async () => {
    const reassignmentWins = await createSeriesWithChapter(
      "delete-reassign-first",
    );
    expect(
      (await assign(reassignmentWins.seriesId, uploaderId)).statusCode,
    ).toBe(200);
    const sessionBlocker = startBlocker(
      (tx) =>
        tx`select id from sessions where user_id = ${uploaderId} for update`,
    );
    await sessionBlocker.ready;
    const deniedDelete = deleteChapter(
      reassignmentWins.chapterId,
      uploaderCookie,
    );
    await waitForBlockedQuery("sessions");
    expect(
      (await assign(reassignmentWins.seriesId, replacementId)).statusCode,
    ).toBe(200);
    sessionBlocker.release();
    await sessionBlocker.done;
    expect((await deniedDelete).statusCode).toBe(403);
    expect(await chapterState(reassignmentWins.chapterId)).not.toBeNull();

    const mutationWins = await createSeriesWithChapter(
      "delete-before-reassign",
    );
    expect((await assign(mutationWins.seriesId, uploaderId)).statusCode).toBe(
      200,
    );
    const chapterBlocker = startBlocker(
      (tx) =>
        tx`select id from chapters where id = ${mutationWins.chapterId} for update`,
    );
    await chapterBlocker.ready;
    const acceptedDelete = deleteChapter(
      mutationWins.chapterId,
      uploaderCookie,
    );
    await waitForBlockedQuery("chapters");
    const laterReassignment = assign(mutationWins.seriesId, replacementId);
    await waitForBlockedQuery("series");
    chapterBlocker.release();
    await chapterBlocker.done;
    expect((await acceptedDelete).statusCode).toBe(204);
    expect((await laterReassignment).statusCode).toBe(200);
    expect(await chapterState(mutationWins.chapterId)).toMatchObject({
      status: "deleting",
    });
  });

  it("serializes helper update with helper revoke and keeps delete non-delegable", async () => {
    const revokeWins = await createSeriesWithChapter("helper-revoke-first");
    const grant = await app.inject({
      method: "POST",
      url: `/chapters/${revokeWins.chapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: helperId, permissions: ["chapters.edit"] },
    });
    expect(grant.statusCode).toBe(204);
    const sessionBlocker = startBlocker(
      (tx) =>
        tx`select id from sessions where user_id = ${helperId} for update`,
    );
    await sessionBlocker.ready;
    const deniedUpdate = patchChapter(
      revokeWins.chapterId,
      helperCookie,
      "revoked-helper",
    );
    await waitForBlockedQuery("sessions");
    const revoke = await app.inject({
      method: "DELETE",
      url: `/chapters/${revokeWins.chapterId}/permissions/${helperId}`,
      headers: { cookie: ownerCookie },
    });
    expect(revoke.statusCode).toBe(204);
    sessionBlocker.release();
    await sessionBlocker.done;
    expect((await deniedUpdate).statusCode).toBe(403);
    expect((await chapterState(revokeWins.chapterId))?.title).toBe("original");

    const mutationWins = await createSeriesWithChapter("helper-mutation-first");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${mutationWins.chapterId}/permissions`,
          headers: { cookie: ownerCookie },
          payload: { userId: helperId, permissions: ["chapters.edit"] },
        })
      ).statusCode,
    ).toBe(204);
    const permissionBlocker = startBlocker(
      (tx) =>
        tx`select id from chapter_permissions where chapter_id = ${mutationWins.chapterId} and helper_user_id = ${helperId} for update`,
    );
    await permissionBlocker.ready;
    const acceptedUpdate = patchChapter(
      mutationWins.chapterId,
      helperCookie,
      "helper-mutation-won",
    );
    await waitForBlockedQuery("chapter_permissions");
    const laterRevoke = app.inject({
      method: "DELETE",
      url: `/chapters/${mutationWins.chapterId}/permissions/${helperId}`,
      headers: { cookie: ownerCookie },
    });
    permissionBlocker.release();
    await permissionBlocker.done;
    expect((await acceptedUpdate).statusCode).toBe(200);
    expect((await laterRevoke).statusCode).toBe(204);
    expect((await chapterState(mutationWins.chapterId))?.title).toBe(
      "helper-mutation-won",
    );
    expect(
      (await deleteChapter(mutationWins.chapterId, helperCookie)).statusCode,
    ).toBe(403);
    expect(await chapterState(mutationWins.chapterId)).not.toBeNull();

    const nonDelegable = await createSeriesWithChapter("helper-delete-race");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${nonDelegable.chapterId}/permissions`,
          headers: { cookie: ownerCookie },
          payload: { userId: helperId, permissions: ["chapters.edit"] },
        })
      ).statusCode,
    ).toBe(204);
    const [helperDelete, concurrentRevoke] = await Promise.all([
      deleteChapter(nonDelegable.chapterId, helperCookie),
      app.inject({
        method: "DELETE",
        url: `/chapters/${nonDelegable.chapterId}/permissions/${helperId}`,
        headers: { cookie: ownerCookie },
      }),
    ]);
    expect(helperDelete.statusCode).toBe(403);
    expect(concurrentRevoke.statusCode).toBe(204);
    expect(await chapterState(nonDelegable.chapterId)).not.toBeNull();
  });

  it("revalidates Series authority and serializes Identity loss in both orders", async () => {
    const revocationWins = await createSeriesWithChapter(
      "series-role-loss-first",
    );
    const sessionBlocker = startBlocker(
      (tx) => tx`select id from sessions where user_id = ${ownerId} for update`,
    );
    await sessionBlocker.ready;
    const deniedUpdate = app.inject({
      method: "PATCH",
      url: `/series/${revocationWins.seriesId}`,
      headers: { cookie: ownerCookie },
      payload: { title: "must-not-commit" },
    });
    await waitForBlockedQuery("sessions");
    await database.db
      .update(users)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(users.id, ownerId));
    sessionBlocker.release();
    await sessionBlocker.done;
    expect((await deniedUpdate).statusCode).toBe(403);
    const [unchanged] = await database.db
      .select({ title: series.title })
      .from(series)
      .where(eq(series.id, revocationWins.seriesId));
    expect(unchanged?.title).not.toBe("must-not-commit");
    await database.db
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(users.id, ownerId));

    const mutationWins = await createSeriesWithChapter("series-update-first");
    const seriesBlocker = startBlocker(
      (tx) =>
        tx`select id from series where id = ${mutationWins.seriesId} for update`,
    );
    await seriesBlocker.ready;
    const acceptedUpdate = app.inject({
      method: "PATCH",
      url: `/series/${mutationWins.seriesId}`,
      headers: { cookie: ownerCookie },
      payload: { title: "series-mutation-won" },
    });
    await waitForBlockedQuery("series");
    const laterSuspension = Promise.resolve(
      database.db
        .update(users)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(eq(users.id, ownerId)),
    );
    await waitForBlockedQuery("users");
    seriesBlocker.release();
    await seriesBlocker.done;
    expect((await acceptedUpdate).statusCode).toBe(200);
    await laterSuspension;
    const [updated] = await database.db
      .select({ title: series.title })
      .from(series)
      .where(eq(series.id, mutationWins.seriesId));
    expect(updated?.title).toBe("series-mutation-won");
    await database.db
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(users.id, ownerId));
  });

  it("serializes concurrent reassignment into exactly one active assignment", async () => {
    const target = await createSeriesWithChapter("concurrent-reassignment");
    expect((await assign(target.seriesId, uploaderId)).statusCode).toBe(200);
    const blocker = startBlocker(
      (tx) =>
        tx`select id from series where id = ${target.seriesId} for update`,
    );
    await blocker.ready;
    const first = assign(target.seriesId, replacementId);
    const second = assign(target.seriesId, helperId);
    await waitForBlockedQuery("series");
    blocker.release();
    await blocker.done;
    expect([(await first).statusCode, (await second).statusCode]).toEqual([
      200, 200,
    ]);
    const rows = await database.db
      .select({ responsibleUserId: seriesAssignments.responsibleUserId })
      .from(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, target.seriesId));
    expect(rows).toHaveLength(1);
    expect([replacementId, helperId]).toContain(rows[0]?.responsibleUserId);
  });

  it("rejects Gestor Series delete before the mutation transaction", async () => {
    const seriesId = await createSeriesOnly("series-delete-gestor-denied");
    const response = await app.inject({
      method: "DELETE",
      url: `/series/${seriesId}`,
      headers: { cookie: ownerCookie },
    });
    expect(response.statusCode).toBe(403);
    expect(
      (
        await database.db
          .select({ id: series.id })
          .from(series)
          .where(eq(series.id, seriesId))
      )[0],
    ).toBeDefined();
  });

  it("revalidates Admin Series delete authority in both commit orders", async () => {
    const revocationWinsId = await createSeriesOnly("series-delete-loss-first");
    const sessionBlocker = startBlocker(
      (tx) => tx`select id from sessions where user_id = ${adminId} for update`,
    );
    await sessionBlocker.ready;
    const deniedDelete = app.inject({
      method: "DELETE",
      url: `/series/${revocationWinsId}`,
      headers: { cookie: adminCookie },
    });
    await waitForBlockedQuery("sessions");
    await database.db
      .update(users)
      .set({ status: "suspended", updatedAt: new Date() })
      .where(eq(users.id, adminId));
    sessionBlocker.release();
    await sessionBlocker.done;
    expect((await deniedDelete).statusCode).toBe(403);
    expect(
      (
        await database.db
          .select({ id: series.id })
          .from(series)
          .where(eq(series.id, revocationWinsId))
      )[0],
    ).toBeDefined();
    await database.db
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(users.id, adminId));

    const mutationWinsId = await createSeriesOnly("series-delete-first");
    const seriesBlocker = startBlocker(
      (tx) => tx`select id from series where id = ${mutationWinsId} for update`,
    );
    await seriesBlocker.ready;
    const acceptedDelete = app.inject({
      method: "DELETE",
      url: `/series/${mutationWinsId}`,
      headers: { cookie: adminCookie },
    });
    await waitForBlockedQuery("series");
    const laterSuspension = Promise.resolve(
      database.db
        .update(users)
        .set({ status: "suspended", updatedAt: new Date() })
        .where(eq(users.id, adminId)),
    );
    await waitForBlockedQuery("users");
    seriesBlocker.release();
    await seriesBlocker.done;
    expect((await acceptedDelete).statusCode).toBe(204);
    await laterSuspension;
    expect(
      (
        await database.db
          .select({ id: series.id })
          .from(series)
          .where(eq(series.id, mutationWinsId))
      )[0],
    ).toBeUndefined();
    await database.db
      .update(users)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(users.id, adminId));
  });

  it("rejects mutation of the stable public slug without changing the Series", async () => {
    const source = await createSeriesWithChapter("rollback-source");
    const conflictTarget = await createSeriesWithChapter("rollback-target");
    const [before] = await database.db
      .select({ title: series.title, slug: series.slug })
      .from(series)
      .where(eq(series.id, source.seriesId));
    const [target] = await database.db
      .select({ slug: series.slug })
      .from(series)
      .where(eq(series.id, conflictTarget.seriesId));
    const response = await app.inject({
      method: "PATCH",
      url: `/series/${source.seriesId}`,
      headers: { cookie: ownerCookie },
      payload: { title: "must-roll-back", slug: target?.slug },
    });
    expect(response.statusCode).toBe(422);
    const [after] = await database.db
      .select({ title: series.title, slug: series.slug })
      .from(series)
      .where(eq(series.id, source.seriesId));
    expect(after).toEqual(before);
    const assignments = await database.db
      .select()
      .from(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, source.seriesId));
    expect(assignments).toHaveLength(1);
  });
});
