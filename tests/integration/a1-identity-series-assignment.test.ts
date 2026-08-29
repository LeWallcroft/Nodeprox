import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
} from "../../packages/storage/src/port.js";
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
const app = buildApp(
  { logger: false },
  {
    database: database.db,
    secureCookie: false,
    storage: { provider: "filesystem", uploadMaxSizeBytes: 1024 },
    uploadTransfer: transfer,
  },
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
      inArray(seriesAssignments.uploaderId, [uploaderId, secondUploaderId]),
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
    ).toBe(403);
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
      url: `/series/${otherSeriesId}/uploader`,
      headers: { cookie: adminCookie },
      payload: { uploaderId: secondUploaderId },
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
      url: `/series/${seriesId}/uploader`,
      headers: { cookie: adminCookie },
      payload: { uploaderId: adminId },
    });
    expect(invalidAssignment.statusCode).toBe(422);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${seriesId}/uploader`,
          headers: { cookie: ownerCookie },
          payload: { uploaderId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${otherSeriesId}/uploader`,
          headers: { cookie: ownerCookie },
          payload: { uploaderId },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${seriesId}/uploader`,
          headers: { cookie: uploaderCookie },
          payload: { uploaderId },
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
    ).not.toEqual(
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
      url: `/series/${seriesId}/uploader`,
      headers: { cookie: adminCookie },
      payload: { uploaderId: secondUploaderId },
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

    const revoked = await app.inject({
      method: "DELETE",
      url: `/series/${seriesId}/uploader`,
      headers: { cookie: adminCookie },
    });
    expect(revoked.statusCode).toBe(204);

    const deniedAfterRevocation = await app.inject({
      method: "GET",
      url: `/series/${seriesId}`,
      headers: { cookie: secondUploaderCookie },
    });
    expect(deniedAfterRevocation.statusCode).toBe(403);
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

  it("keeps concurrent assignment and revocation in one valid row", async () => {
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
        url: `/series/${seriesId}/uploader`,
        headers: { cookie: adminCookie },
        payload: { uploaderId },
      }),
      app.inject({
        method: "PUT",
        url: `/series/${seriesId}/uploader`,
        headers: { cookie: adminCookie },
        payload: { uploaderId: secondUploaderId },
      }),
      app.inject({
        method: "DELETE",
        url: `/series/${seriesId}/uploader`,
        headers: { cookie: adminCookie },
      }),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 200, 204,
    ]);
    const rows = await database.db
      .select({ uploaderId: seriesAssignments.uploaderId })
      .from(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, seriesId));
    expect(rows.length).toBeLessThanOrEqual(1);
    if (rows[0])
      expect([uploaderId, secondUploaderId]).toContain(rows[0].uploaderId);

    expect(
      (
        await app.inject({
          method: "PUT",
          url: `/series/${seriesId}/uploader`,
          headers: { cookie: adminCookie },
          payload: { uploaderId },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/series/${seriesId}/uploader`,
          headers: { cookie: adminCookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      await database.db
        .select()
        .from(seriesAssignments)
        .where(eq(seriesAssignments.seriesId, seriesId)),
    ).toHaveLength(0);
  });
});
