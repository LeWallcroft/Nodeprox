import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterDeletionOutbox,
  chapterPermissions,
  chapters,
  series,
  seriesAssignments,
  sessions,
  users,
} from "../../database/schema/index.js";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
} from "../../packages/storage/src/port.js";
import {
  FakeDiscordSeriesChannelGateway,
  withM2DSeriesFixtures,
} from "./helpers/discord-series-channel-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);

class AssignmentTransfer implements UploadTransferPort {
  async initiate(input: { key: string }) {
    return {
      mode: "single" as const,
      method: "PUT" as const,
      url: `https://s3.example.test/${encodeURIComponent(input.key)}?signature=temporary`,
      headers: { "content-type": "application/zip" },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async verify(): Promise<never> {
    throw new UploadTransferObjectNotFoundError();
  }

  async abort(): Promise<void> {}
}

const transfer = new AssignmentTransfer();
const app = withM2DSeriesFixtures(
  buildApp(
    { logger: false },
    {
      database: database.db,
      secureCookie: false,
      storage: { provider: "filesystem", uploadMaxSizeBytes: 1024 },
      uploadTransfer: transfer,
      seriesChannelGateway: new FakeDiscordSeriesChannelGateway(),
    },
  ),
);
const password = "a1-correct-password";
const hasher = new Argon2PasswordHasher();
const adminId = randomUUID();
const ownerId = randomUUID();
const secondOwnerId = randomUUID();
const uploaderId = randomUUID();
const secondUploaderId = randomUUID();
const emails = {
  admin: `a1-admin-${adminId}@example.com`,
  owner: `a1-owner-${ownerId}@example.com`,
  secondOwner: `a1-owner-${secondOwnerId}@example.com`,
  uploader: `a1-uploader-${uploaderId}@example.com`,
  secondUploader: `a1-uploader-${secondUploaderId}@example.com`,
};

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  return cookieValue(response.headers["set-cookie"]);
}

beforeAll(async () => {
  const passwordHash = await hasher.hash(password);
  await database.db.insert(users).values([
    {
      id: adminId,
      email: emails.admin,
      passwordHash,
      status: "active",
      role: "admin",
    },
    {
      id: ownerId,
      email: emails.owner,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: secondOwnerId,
      email: emails.secondOwner,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: uploaderId,
      email: emails.uploader,
      passwordHash,
      status: "active",
      role: "uploader",
    },
    {
      id: secondUploaderId,
      email: emails.secondUploader,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
});

afterAll(async () => {
  await database.db
    .delete(chapterDeletionOutbox)
    .where(
      inArray(chapterDeletionOutbox.requestedBy, [
        adminId,
        ownerId,
        secondOwnerId,
        uploaderId,
        secondUploaderId,
      ]),
    );
  await database.db
    .delete(seriesAssignments)
    .where(
      inArray(seriesAssignments.responsibleUserId, [
        uploaderId,
        secondUploaderId,
      ]),
    );
  await database.db
    .delete(auditLogs)
    .where(
      inArray(auditLogs.actorId, [
        adminId,
        ownerId,
        secondOwnerId,
        uploaderId,
        secondUploaderId,
      ]),
    );
  await database.db
    .delete(chapters)
    .where(
      inArray(chapters.createdBy, [
        adminId,
        ownerId,
        secondOwnerId,
        uploaderId,
        secondUploaderId,
      ]),
    );
  const ownedSeries = await database.db
    .select({ id: series.id })
    .from(series)
    .where(
      inArray(series.createdBy, [adminId, ownerId, secondOwnerId, uploaderId]),
    );
  if (ownedSeries.length > 0)
    await database.db.delete(series).where(
      inArray(
        series.id,
        ownedSeries.map((item) => item.id),
      ),
    );
  await database.db
    .delete(users)
    .where(
      inArray(users.id, [
        adminId,
        ownerId,
        secondOwnerId,
        uploaderId,
        secondUploaderId,
      ]),
    );
  await app.close();
  await database.sql.end();
});

describe("A1 identity, assignment and chapter numbering", () => {
  it("projects the paginated administrative user read model", async () => {
    const adminCookie = await login(emails.admin);
    const response = await app.inject({
      method: "GET",
      url: "/admin/users/management?limit=2&role=uploader",
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ total: expect.any(Number) });
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({
      assignedSeriesCount: expect.any(Number),
    });
    expect(body.items[0]).toHaveProperty("lastAccessAt");
  });

  it("replaces a user's Series responsibilities atomically", async () => {
    const assignedSeriesId = randomUUID();
    const releasedSeriesId = randomUUID();
    await database.db.insert(series).values([
      {
        id: assignedSeriesId,
        title: "Bulk assignment target",
        slug: `bulk-assignment-target-${assignedSeriesId}`,
        createdBy: ownerId,
      },
      {
        id: releasedSeriesId,
        title: "Bulk assignment release",
        slug: `bulk-assignment-release-${releasedSeriesId}`,
        createdBy: ownerId,
      },
    ]);
    await database.db.insert(seriesAssignments).values({
      seriesId: releasedSeriesId,
      responsibleUserId: uploaderId,
      assignedBy: adminId,
    });
    const adminCookie = await login(emails.admin);

    const replaced = await app.inject({
      method: "PUT",
      url: `/admin/users/${uploaderId}/series-responsibilities`,
      headers: { cookie: adminCookie },
      payload: { seriesIds: [assignedSeriesId] },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json()).toEqual({
      assigned: 1,
      released: 1,
      unchanged: 0,
    });
    expect(
      await database.db
        .select({ seriesId: seriesAssignments.seriesId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.responsibleUserId, uploaderId)),
    ).toEqual([{ seriesId: assignedSeriesId }]);

    const rejected = await app.inject({
      method: "PUT",
      url: `/admin/users/${uploaderId}/series-responsibilities`,
      headers: { cookie: adminCookie },
      payload: { seriesIds: [assignedSeriesId, randomUUID()] },
    });
    expect(rejected.statusCode).toBe(404);
    expect(
      await database.db
        .select({ seriesId: seriesAssignments.seriesId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.responsibleUserId, uploaderId)),
    ).toEqual([{ seriesId: assignedSeriesId }]);
  });

  it("separates a deactivated user from sessions, Series and chapter collaborations", async () => {
    const userId = randomUUID();
    const seriesId = randomUUID();
    const chapterId = randomUUID();
    const email = `deactivate-${userId}@example.com`;
    const passwordHash = await hasher.hash(password);
    await database.db.insert(users).values({
      id: userId,
      email,
      passwordHash,
      status: "active",
      role: "uploader",
    });
    await database.db.insert(series).values({
      id: seriesId,
      title: "Deactivation fixture",
      slug: `deactivation-${userId}`,
      createdBy: ownerId,
    });
    await database.db.insert(seriesAssignments).values({
      seriesId,
      responsibleUserId: userId,
      assignedBy: adminId,
    });
    await database.db.insert(chapters).values({
      id: chapterId,
      seriesId,
      chapterNumber: 1,
      publicKey: `deactivation-${userId}`,
      createdBy: ownerId,
    });
    await database.db.insert(chapterPermissions).values({
      chapterId,
      helperUserId: userId,
      permission: "chapters.read",
      grantedBy: adminId,
    });

    const userCookie = await login(email);
    const adminCookie = await login(emails.admin);
    const response = await app.inject({
      method: "PATCH",
      url: `/admin/users/${userId}`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "suspended" });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie: userCookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      await database.db
        .select({ id: seriesAssignments.id })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.responsibleUserId, userId)),
    ).toEqual([]);
    expect(
      (
        await database.db
          .select({ revokedAt: chapterPermissions.revokedAt })
          .from(chapterPermissions)
          .where(eq(chapterPermissions.helperUserId, userId))
      )[0]?.revokedAt,
    ).toBeTruthy();
    expect(
      (
        await database.db
          .select({ revokedAt: sessions.revokedAt })
          .from(sessions)
          .where(eq(sessions.userId, userId))
      )[0]?.revokedAt,
    ).toBeTruthy();
    expect(
      await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(eq(auditLogs.action, "user.deactivated")),
    ).toEqual(expect.arrayContaining([expect.any(Object)]));

    await database.db
      .delete(chapterPermissions)
      .where(eq(chapterPermissions.helperUserId, userId));
    await database.db.delete(chapters).where(eq(chapters.id, chapterId));
    await database.db.delete(series).where(eq(series.id, seriesId));
    await database.db.delete(sessions).where(eq(sessions.userId, userId));
    await database.db.delete(auditLogs).where(eq(auditLogs.resourceId, userId));
    await database.db.delete(users).where(eq(users.id, userId));
  });

  it("registers pending users and blocks operational login until admin approval", async () => {
    const email = `pending-${randomUUID()}@example.com`;
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, discordUsername: "pending-user", password },
    });
    expect(registration.statusCode).toBe(201);
    expect(registration.json()).toMatchObject({
      status: "pending",
      role: "uploader",
    });
    const pendingLogin = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email, password },
    });
    expect(pendingLogin.statusCode).toBe(403);
    expect(pendingLogin.json().code).toBe("account-pending");
    const adminCookie = await login(emails.admin);
    const pending = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    const pendingId = pending[0]?.id;
    expect(pendingId).toBeDefined();
    const ownerCookie = await login(emails.owner);
    const uploaderCookie = await login(emails.uploader);
    for (const cookie of [ownerCookie, uploaderCookie]) {
      const denied = await app.inject({
        method: "PATCH",
        url: `/admin/users/${pendingId}`,
        headers: { cookie },
        payload: { status: "active", role: "admin" },
      });
      expect(denied.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/admin/users/${pendingId}`,
          headers: { cookie: adminCookie },
          payload: { status: "suspended" },
        })
      ).statusCode,
    ).toBe(409);
    const approval = await app.inject({
      method: "PATCH",
      url: `/admin/users/${pendingId}`,
      headers: { cookie: adminCookie },
      payload: { status: "active", role: "uploader" },
    });
    expect(approval.statusCode).toBe(200);
    expect(approval.json()).toMatchObject({
      status: "active",
      role: "uploader",
    });
    for (const role of ["admin", "gestor", "uploader"] as const) {
      const assignment = await app.inject({
        method: "PATCH",
        url: `/admin/users/${pendingId}`,
        headers: { cookie: adminCookie },
        payload: { status: "active", role },
      });
      expect(assignment.statusCode).toBe(200);
      expect(assignment.json().role).toBe(role);
    }
    const activeCookie = await login(email);
    const suspended = await app.inject({
      method: "PATCH",
      url: `/admin/users/${pendingId}`,
      headers: { cookie: adminCookie },
      payload: { status: "suspended" },
    });
    expect(suspended.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie: activeCookie },
        })
      ).statusCode,
    ).toBe(401);
    const reactivated = await app.inject({
      method: "PATCH",
      url: `/admin/users/${pendingId}`,
      headers: { cookie: adminCookie },
      payload: { status: "active", role: "uploader" },
    });
    expect(reactivated.statusCode).toBe(200);
    expect(reactivated.json()).toMatchObject({
      status: "active",
      role: "uploader",
    });
    expect(await login(email)).toBeTruthy();

    const rejectedEmail = `rejected-${randomUUID()}@example.com`;
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: rejectedEmail,
        discordUsername: "rejected-user",
        password,
      },
    });
    const [rejectedUser] = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, rejectedEmail));
    expect(rejectedUser).toBeDefined();
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/admin/users/${rejectedUser?.id}`,
          headers: { cookie: adminCookie },
          payload: { status: "rejected" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email: rejectedEmail, password },
        })
      ).statusCode,
    ).toBe(401);
    if (rejectedUser)
      await database.db.delete(users).where(eq(users.id, rejectedUser.id));
    await database.db.delete(users).where(eq(users.id, pendingId as string));
  });

  it("enforces admin/owner/uploader capabilities and assignment", async () => {
    const ownerCookie = await login(emails.owner);
    const otherOwnerCookie = await login(emails.secondOwner);
    const uploaderCookie = await login(emails.uploader);
    const secondUploaderCookie = await login(emails.secondUploader);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Owned", slug: `a1-owned-${randomUUID()}` },
    });
    expect(created.statusCode).toBe(201);
    const seriesId = created.json().id as string;
    const other = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: otherOwnerCookie },
      payload: { title: "Other", slug: `a1-other-${randomUUID()}` },
    });
    expect(other.statusCode).toBe(201);
    const otherSeriesId = other.json().id as string;
    const adminCookie = await login(emails.admin);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/series/${seriesId}`,
          headers: { cookie: adminCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/series",
          headers: { cookie: uploaderCookie },
          payload: { title: "Denied", slug: `a1-denied-${randomUUID()}` },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/admin/users",
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/admin/users",
          headers: { cookie: uploaderCookie },
        })
      ).statusCode,
    ).toBe(403);
    const adminAssignment = await app.inject({
      method: "PUT",
      url: `/series/${otherSeriesId}/responsible`,
      headers: { cookie: adminCookie },
      payload: { responsibleUserId: secondUploaderId },
    });
    expect(adminAssignment.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/series/${otherSeriesId}`,
          headers: { cookie: secondUploaderCookie },
        })
      ).statusCode,
    ).toBe(200);
    const invalidAssignment = await app.inject({
      method: "PUT",
      url: `/series/${seriesId}/responsible`,
      headers: { cookie: adminCookie },
      payload: { responsibleUserId: adminId },
    });
    expect(invalidAssignment.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${seriesId}/responsible`,
          headers: { cookie: ownerCookie },
          payload: { responsibleUserId: uploaderId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${otherSeriesId}/responsible`,
          headers: { cookie: ownerCookie },
          payload: { responsibleUserId: uploaderId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${seriesId}/responsible`,
          headers: { cookie: uploaderCookie },
          payload: { responsibleUserId: uploaderId },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/series",
          headers: { cookie: ownerCookie },
        })
      ).json(),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: otherSeriesId })]),
    );
    const ownerChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
      payload: { chapterNumber: 25, title: "Owner chapter" },
    });
    expect(ownerChapter.statusCode).toBe(201);
    const ownerChapterId = ownerChapter.json().id as string;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/series/${seriesId}`,
          headers: { cookie: ownerCookie },
          payload: { description: "Owner remains authoritative" },
        })
      ).statusCode,
    ).toBe(200);
    const ownerUpload = await app.inject({
      method: "POST",
      url: `/chapters/${ownerChapterId}/uploads/initiate`,
      headers: { cookie: ownerCookie },
      payload: {
        filename: "owner.zip",
        contentType: "application/zip",
        sizeBytes: 16,
      },
    });
    expect(ownerUpload.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${ownerChapterId}/uploads/${ownerUpload.json().uploadId}/abort`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(204);
    const first = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: uploaderCookie },
      payload: { chapterNumber: 26, title: "Twenty six" },
    });
    expect(first.statusCode).toBe(201);
    const firstChapterId = first.json().id as string;
    const skipped = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: uploaderCookie },
      payload: { chapterNumber: 30, title: "Thirty" },
    });
    expect(skipped.statusCode).toBe(201);
    const numbered = await app.inject({
      method: "GET",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: uploaderCookie },
    });
    expect(
      numbered
        .json()
        .map((chapter: { chapterNumber: number }) => chapter.chapterNumber),
    ).toEqual([25, 26, 30]);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/chapters/${firstChapterId}`,
          headers: { cookie: uploaderCookie },
          payload: { title: "Edited by assigned uploader" },
        })
      ).statusCode,
    ).toBe(200);
    const concurrent = await Promise.all([
      app.inject({
        method: "POST",
        url: `/series/${seriesId}/chapters`,
        headers: { cookie: uploaderCookie },
        payload: { chapterNumber: 40, title: "Forty A" },
      }),
      app.inject({
        method: "POST",
        url: `/series/${seriesId}/chapters`,
        headers: { cookie: uploaderCookie },
        payload: { chapterNumber: 40, title: "Forty B" },
      }),
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);

    const reassigned = await app.inject({
      method: "PUT",
      url: `/series/${seriesId}/responsible`,
      headers: { cookie: adminCookie },
      payload: { responsibleUserId: secondUploaderId },
    });
    expect(reassigned.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/series/${seriesId}`,
          headers: { cookie: uploaderCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/chapters/${firstChapterId}`,
          headers: { cookie: uploaderCookie },
          payload: { title: "Creator denied after reassignment" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/chapters/${ownerChapterId}`,
          headers: { cookie: uploaderCookie },
          payload: { title: "Denied after reassignment" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${ownerChapterId}`,
          headers: { cookie: uploaderCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/series/${seriesId}`,
          headers: { cookie: uploaderCookie },
          payload: { title: "Denied series mutation" },
        })
      ).statusCode,
    ).toBe(403);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${ownerChapterId}/uploads/initiate`,
          headers: { cookie: uploaderCookie },
          payload: {
            filename: "chapter.zip",
            contentType: "application/zip",
            sizeBytes: 16,
          },
        })
      ).statusCode,
    ).toBe(403);

    const reassignedGet = await app.inject({
      method: "GET",
      url: `/series/${seriesId}`,
      headers: { cookie: secondUploaderCookie },
    });
    expect(reassignedGet.statusCode).toBe(200);
    const assignedChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: secondUploaderCookie },
      payload: { chapterNumber: 5, title: "Assigned" },
    });
    expect(assignedChapter.statusCode).toBe(201);
    const assignedChapterId = assignedChapter.json().id as string;
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/chapters/${assignedChapterId}`,
          headers: { cookie: secondUploaderCookie },
          payload: { title: "Edited by assigned uploader" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/chapters/${assignedChapterId}/capabilities`,
          headers: { cookie: secondUploaderCookie },
        })
      ).json().capabilities,
    ).toEqual(
      expect.arrayContaining([
        "chapters.helper.grant",
        "chapters.helper.revoke",
      ]),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${assignedChapterId}/permissions`,
          headers: { cookie: secondUploaderCookie },
          payload: { userId: uploaderId, permissions: ["chapters.edit"] },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${assignedChapterId}/permissions`,
          headers: { cookie: uploaderCookie },
          payload: { userId: ownerId, permissions: ["chapters.read"] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${assignedChapterId}/permissions/${secondUploaderId}`,
          headers: { cookie: uploaderCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${assignedChapterId}/permissions/${uploaderId}`,
          headers: { cookie: secondUploaderCookie },
        })
      ).statusCode,
    ).toBe(204);
    const uploadResponse = await app.inject({
      method: "POST",
      url: `/chapters/${assignedChapterId}/uploads/initiate`,
      headers: { cookie: secondUploaderCookie },
      payload: {
        filename: "chapter.zip",
        contentType: "application/zip",
        sizeBytes: 16,
      },
    });
    expect(uploadResponse.statusCode).toBe(201);
    const assignedUploadId = uploadResponse.json().uploadId as string;
    const deletableChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: secondUploaderCookie },
      payload: { chapterNumber: 6, title: "Delete by assigned uploader" },
    });
    const deletableChapterId = deletableChapter.json().id as string;
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${deletableChapterId}`,
          headers: { cookie: secondUploaderCookie },
        })
      ).statusCode,
    ).toBe(204);

    const returnedToOwner = await app.inject({
      method: "PUT",
      url: `/series/${seriesId}/responsible`,
      headers: { cookie: adminCookie },
      payload: { responsibleUserId: ownerId },
    });
    expect(returnedToOwner.statusCode).toBe(200);

    const deniedAfterRevocation = await app.inject({
      method: "GET",
      url: `/series/${seriesId}`,
      headers: { cookie: secondUploaderCookie },
    });
    expect(deniedAfterRevocation.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/chapters/${assignedChapterId}/capabilities`,
          headers: { cookie: secondUploaderCookie },
        })
      ).json().capabilities,
    ).not.toEqual(
      expect.arrayContaining([
        "chapters.helper.grant",
        "chapters.helper.revoke",
      ]),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${assignedChapterId}/permissions`,
          headers: { cookie: secondUploaderCookie },
          payload: { userId: uploaderId, permissions: ["chapters.read"] },
        })
      ).statusCode,
    ).toBe(403);
    const completeAfterRevocation = await app.inject({
      method: "POST",
      url: `/chapters/${assignedChapterId}/uploads/${assignedUploadId}/complete`,
      headers: { cookie: secondUploaderCookie },
    });
    expect(completeAfterRevocation.statusCode).toBe(403);
    const abortAfterRevocation = await app.inject({
      method: "POST",
      url: `/chapters/${assignedChapterId}/uploads/${assignedUploadId}/abort`,
      headers: { cookie: secondUploaderCookie },
    });
    expect(abortAfterRevocation.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${assignedChapterId}/uploads/${assignedUploadId}/abort`,
          headers: { cookie: adminCookie },
        })
      ).statusCode,
    ).toBe(204);
  });

  it("keeps Gestor responsible assignment operational without transferring ownership", async () => {
    const ownerCookie = await login(emails.owner);
    const foreignOwnerCookie = await login(emails.secondOwner);
    const adminCookie = await login(emails.admin);
    const uploaderCookie = await login(emails.uploader);
    const ownSeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: {
        title: "Assignment owned",
        slug: `a1-assignment-own-${randomUUID()}`,
      },
    });
    expect(ownSeries.statusCode).toBe(201);
    const ownSeriesId = ownSeries.json().id as string;
    const foreignSeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: foreignOwnerCookie },
      payload: {
        title: "Assignment foreign",
        slug: `a1-assignment-foreign-${randomUUID()}`,
      },
    });
    expect(foreignSeries.statusCode).toBe(201);
    const foreignSeriesId = foreignSeries.json().id as string;

    const assignOwned = await app.inject({
      method: "PUT",
      url: `/series/${ownSeriesId}/responsible`,
      headers: { cookie: ownerCookie },
      payload: { responsibleUserId: uploaderId },
    });
    expect(assignOwned.statusCode).toBe(200);
    await expect(
      database.db
        .select({ responsibleUserId: seriesAssignments.responsibleUserId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, ownSeriesId)),
    ).resolves.toEqual([{ responsibleUserId: uploaderId }]);
    await expect(
      database.db
        .select({ createdBy: series.createdBy })
        .from(series)
        .where(eq(series.id, ownSeriesId)),
    ).resolves.toEqual([{ createdBy: ownerId }]);

    const returnOwnedToOwner = await app.inject({
      method: "PUT",
      url: `/series/${ownSeriesId}/responsible`,
      headers: { cookie: ownerCookie },
      payload: { responsibleUserId: ownerId },
    });
    expect(returnOwnedToOwner.statusCode).toBe(200);
    await expect(
      database.db
        .select({ responsibleUserId: seriesAssignments.responsibleUserId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, ownSeriesId)),
    ).resolves.toEqual([{ responsibleUserId: ownerId }]);
    await expect(
      database.db
        .select({ createdBy: series.createdBy })
        .from(series)
        .where(eq(series.id, ownSeriesId)),
    ).resolves.toEqual([{ createdBy: ownerId }]);

    const adminAssignForeign = await app.inject({
      method: "PUT",
      url: `/series/${foreignSeriesId}/responsible`,
      headers: { cookie: adminCookie },
      payload: { responsibleUserId: uploaderId },
    });
    expect(adminAssignForeign.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${foreignSeriesId}/responsible`,
          headers: { cookie: ownerCookie },
          payload: { responsibleUserId: secondUploaderId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${ownSeriesId}/responsible`,
          headers: { cookie: uploaderCookie },
          payload: { responsibleUserId: uploaderId },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("allows Gestor global Series operations while reserving deletion", async () => {
    const ownerCookie = await login(emails.owner);
    const supportGestorCookie = await login(emails.secondOwner);
    const unrelatedUploaderCookie = await login(emails.uploader);
    const foreign = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: {
        title: "Support target",
        slug: `a1-support-${randomUUID()}`,
      },
    });
    expect(foreign.statusCode).toBe(201);
    const foreignSeriesId = foreign.json().id as string;

    const visible = await app.inject({
      method: "GET",
      url: `/series/${foreignSeriesId}`,
      headers: { cookie: supportGestorCookie },
    });
    expect(visible.statusCode).toBe(200);

    const capabilities = await app.inject({
      method: "GET",
      url: `/series/${foreignSeriesId}/capabilities`,
      headers: { cookie: supportGestorCookie },
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().capabilities).toEqual(
      expect.arrayContaining([
        "series.read",
        "series.edit",
        "series.assignment.manage",
        "chapters.create",
      ]),
    );
    expect(capabilities.json().capabilities).not.toEqual(
      expect.arrayContaining(["series.delete"]),
    );

    const edited = await app.inject({
      method: "PATCH",
      url: `/series/${foreignSeriesId}`,
      headers: { cookie: supportGestorCookie },
      payload: { title: "Edited foreign Series" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().title).toBe("Edited foreign Series");

    const assigned = await app.inject({
      method: "PUT",
      url: `/series/${foreignSeriesId}/responsible`,
      headers: { cookie: supportGestorCookie },
      payload: { responsibleUserId: uploaderId },
    });
    expect(assigned.statusCode).toBe(200);
    await expect(
      database.db
        .select({ responsibleUserId: seriesAssignments.responsibleUserId })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, foreignSeriesId)),
    ).resolves.toEqual([{ responsibleUserId: uploaderId }]);
    await expect(
      database.db
        .select({ action: auditLogs.action, actorId: auditLogs.actorId })
        .from(auditLogs)
        .where(eq(auditLogs.resourceId, foreignSeriesId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "series.responsibility.reassigned",
          actorId: secondOwnerId,
        }),
      ]),
    );

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/series/${foreignSeriesId}`,
          headers: { cookie: supportGestorCookie },
          payload: {
            role: "admin",
            capabilities: ["series.delete"],
          },
        })
      ).statusCode,
    ).toBe(403);

    const chapter = await app.inject({
      method: "POST",
      url: `/series/${foreignSeriesId}/chapters`,
      headers: { cookie: supportGestorCookie },
      payload: { chapterNumber: 91, title: "Supported chapter" },
    });
    expect(chapter.statusCode).toBe(201);
    const chapterId = chapter.json().id as string;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/series/${foreignSeriesId}/chapters`,
          headers: { cookie: supportGestorCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/chapters",
          headers: { cookie: supportGestorCookie },
        })
      ).json(),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: chapterId,
          series: expect.objectContaining({ id: foreignSeriesId }),
        }),
      ]),
    );
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/chapters/${chapterId}`,
          headers: { cookie: supportGestorCookie },
          payload: { title: "Edited by support Gestor" },
        })
      ).statusCode,
    ).toBe(200);
    const upload = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/uploads/initiate`,
      headers: { cookie: supportGestorCookie },
      payload: {
        filename: "support.zip",
        contentType: "application/zip",
        sizeBytes: 16,
      },
    });
    expect(upload.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${chapterId}/uploads/${upload.json().uploadId}/abort`,
          headers: { cookie: supportGestorCookie },
        })
      ).statusCode,
    ).toBe(204);
    const chapterCapabilities = await app.inject({
      method: "GET",
      url: `/chapters/${chapterId}/capabilities`,
      headers: { cookie: supportGestorCookie },
    });
    expect(chapterCapabilities.statusCode).toBe(200);
    expect(chapterCapabilities.json().capabilities).toEqual(
      expect.arrayContaining([
        "chapters.helper.grant",
        "chapters.helper.revoke",
      ]),
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/chapters/${chapterId}/helper-candidates`,
          headers: { cookie: supportGestorCookie },
        })
      ).statusCode,
    ).toBe(200);
    const helperCookie = await login(emails.secondUploader);
    const foreignGrant = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/permissions`,
      headers: { cookie: supportGestorCookie },
      payload: { userId: secondUploaderId, permissions: ["chapters.edit"] },
    });
    expect(foreignGrant.statusCode).toBe(204);
    await expect(
      database.db
        .select({
          grantedBy: chapterPermissions.grantedBy,
          permission: chapterPermissions.permission,
          revokedAt: chapterPermissions.revokedAt,
        })
        .from(chapterPermissions)
        .where(eq(chapterPermissions.chapterId, chapterId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          grantedBy: secondOwnerId,
          permission: "chapters.edit",
          revokedAt: null,
        }),
      ]),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${chapterId}/permissions`,
          headers: { cookie: helperCookie },
          payload: { userId: uploaderId, permissions: ["chapters.read"] },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${chapterId}/permissions/${secondUploaderId}`,
          headers: { cookie: helperCookie },
        })
      ).statusCode,
    ).toBe(403);
    const foreignRevoke = await app.inject({
      method: "DELETE",
      url: `/chapters/${chapterId}/permissions/${secondUploaderId}`,
      headers: { cookie: supportGestorCookie },
    });
    expect(foreignRevoke.statusCode).toBe(204);
    await expect(
      database.db
        .select({
          revokedAt: chapterPermissions.revokedAt,
          revokedBy: chapterPermissions.revokedBy,
        })
        .from(chapterPermissions)
        .where(eq(chapterPermissions.chapterId, chapterId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          revokedAt: expect.any(Date),
          revokedBy: secondOwnerId,
        }),
      ]),
    );
    await expect(
      database.db
        .select({ action: auditLogs.action, actorId: auditLogs.actorId })
        .from(auditLogs)
        .where(eq(auditLogs.resourceId, chapterId)),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "chapter.permission.granted",
          actorId: secondOwnerId,
        }),
        expect.objectContaining({
          action: "chapter.permission.revoked",
          actorId: secondOwnerId,
        }),
      ]),
    );

    const batch = await app.inject({
      method: "POST",
      url: `/series/${foreignSeriesId}/import-batches`,
      headers: { cookie: supportGestorCookie },
      payload: {
        items: [
          {
            clientId: "support-bulk-1",
            chapterNumber: 92,
            filename: "support-bulk.zip",
            contentType: "application/zip",
            sizeBytes: 16,
          },
        ],
      },
    });
    expect(batch.statusCode).toBe(201);
    const batchItem = batch.json().items[0] as {
      chapterId: string;
      uploadId: string;
      itemId: string;
    };
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${batchItem.chapterId}/uploads/${batchItem.uploadId}/abort`,
          headers: { cookie: supportGestorCookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/series/${foreignSeriesId}/import-batches/${batch.json().batchId}/items/${batchItem.itemId}/retry`,
          headers: { cookie: supportGestorCookie },
          payload: { contentType: "application/zip", sizeBytes: 16 },
        })
      ).statusCode,
    ).toBe(201);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/series/${foreignSeriesId}/chapters`,
          headers: { cookie: unrelatedUploaderCookie },
          payload: { chapterNumber: 93 },
        })
      ).statusCode,
    ).toBe(201);

    const [storedSeries] = await database.db
      .select({ createdBy: series.createdBy })
      .from(series)
      .where(eq(series.id, foreignSeriesId));
    expect(storedSeries?.createdBy).toBe(ownerId);
    expect(
      await database.db
        .select({ id: seriesAssignments.id })
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, foreignSeriesId)),
    ).toHaveLength(1);
    expect(
      await database.db
        .select({
          actorId: auditLogs.actorId,
          requestId: auditLogs.requestId,
        })
        .from(auditLogs)
        .where(eq(auditLogs.resourceId, chapterId)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorId: secondOwnerId,
          requestId: expect.any(String),
        }),
      ]),
    );

    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${chapterId}`,
          headers: { cookie: supportGestorCookie },
        })
      ).statusCode,
    ).toBe(204);
  });

  it("reserves Series deletion for admins and preserves the Chapter conflict", async () => {
    const gestorCookie = await login(emails.owner);
    const foreignGestorCookie = await login(emails.secondOwner);
    const adminCookie = await login(emails.admin);
    const ownSeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: gestorCookie },
      payload: {
        title: "Gestor deletion own",
        slug: `a1-delete-own-${randomUUID()}`,
      },
    });
    const foreignSeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: foreignGestorCookie },
      payload: {
        title: "Gestor deletion foreign",
        slug: `a1-delete-foreign-${randomUUID()}`,
      },
    });
    expect(ownSeries.statusCode).toBe(201);
    expect(foreignSeries.statusCode).toBe(201);
    for (const seriesId of [
      ownSeries.json().id as string,
      foreignSeries.json().id as string,
    ]) {
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: `/series/${seriesId}`,
            headers: { cookie: gestorCookie },
          })
        ).statusCode,
      ).toBe(403);
    }

    const emptySeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: adminCookie },
      payload: { title: "Admin deletable", slug: `a1-delete-${randomUUID()}` },
    });
    expect(emptySeries.statusCode).toBe(201);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/series/${emptySeries.json().id as string}`,
          headers: { cookie: adminCookie },
        })
      ).statusCode,
    ).toBe(204);

    const withChapter = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: adminCookie },
      payload: {
        title: "Admin Chapter conflict",
        slug: `a1-delete-conflict-${randomUUID()}`,
      },
    });
    expect(withChapter.statusCode).toBe(201);
    const withChapterId = withChapter.json().id as string;
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/series/${withChapterId}/chapters`,
          headers: { cookie: adminCookie },
          payload: { chapterNumber: 1, title: "Blocks deletion" },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/series/${withChapterId}`,
          headers: { cookie: adminCookie },
        })
      ).statusCode,
    ).toBe(409);
  });

  it("keeps concurrent responsibility changes in one valid row", async () => {
    const ownerCookie = await login(emails.owner);
    const adminCookie = await login(emails.admin);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: {
        title: "Concurrent assignment",
        slug: `a1-concurrent-${randomUUID()}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const seriesId = created.json().id as string;

    const results = await Promise.all([
      app.inject({
        method: "PUT",
        url: `/series/${seriesId}/responsible`,
        headers: { cookie: adminCookie },
        payload: { responsibleUserId: uploaderId },
      }),
      app.inject({
        method: "PUT",
        url: `/series/${seriesId}/responsible`,
        headers: { cookie: adminCookie },
        payload: { responsibleUserId: secondUploaderId },
      }),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 200,
    ]);
    const rows = await database.db
      .select({ responsibleUserId: seriesAssignments.responsibleUserId })
      .from(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, seriesId));
    expect(rows).toHaveLength(1);
    if (rows[0])
      expect([uploaderId, secondUploaderId]).toContain(
        rows[0].responsibleUserId,
      );

    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${seriesId}/responsible`,
          headers: { cookie: adminCookie },
          payload: { responsibleUserId: uploaderId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await database.db
        .select()
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, seriesId)),
    ).toHaveLength(1);
  });
});
