import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapters,
  series,
  seriesAssignments,
  uploads,
  users,
} from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
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

describe("A1 identity, assignment and chapter sequencing", () => {
  it("registers pending users and blocks operational login until admin approval", async () => {
    const email = `pending-${randomUUID()}@example.com`;
    const registration = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email, password },
    });
    expect(registration.statusCode).toBe(201);
    expect(registration.json()).toMatchObject({
      status: "pending",
      role: "uploader",
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email, password },
        })
      ).statusCode,
    ).toBe(401);
    const adminCookie = await login(emails.admin);
    const pending = await database.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    const pendingId = pending[0]?.id;
    expect(pendingId).toBeDefined();
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
    await database.db
      .update(users)
      .set({ status: "rejected" })
      .where(eq(users.id, pendingId as string));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email, password },
        })
      ).statusCode,
    ).toBe(401);
    await database.db
      .update(users)
      .set({ status: "suspended" })
      .where(eq(users.id, pendingId as string));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/auth/login",
          payload: { email, password },
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
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: otherSeriesId })]),
    );
    const ownerChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
      payload: { chapterNumber: 1, title: "Owner chapter" },
    });
    expect(ownerChapter.statusCode).toBe(201);
    const ownerChapterId = ownerChapter.json().id as string;
    const first = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: uploaderCookie },
      payload: { chapterNumber: 2, title: "Two" },
    });
    expect(first.statusCode).toBe(201);
    const firstChapterId = first.json().id as string;
    const skipped = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: uploaderCookie },
      payload: { chapterNumber: 4, title: "Skipped" },
    });
    expect(skipped.statusCode).toBe(409);
    const second = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: uploaderCookie },
      payload: { chapterNumber: 3, title: "Three" },
    });
    expect(second.statusCode).toBe(201);
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
        payload: { chapterNumber: 4, title: "Four A" },
      }),
      app.inject({
        method: "POST",
        url: `/series/${seriesId}/chapters`,
        headers: { cookie: uploaderCookie },
        payload: { chapterNumber: 4, title: "Four B" },
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

    const multipart = () => {
      const boundary = `a1-${randomUUID()}`;
      const body = [
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="chapter.zip"',
        "Content-Type: application/zip",
        "",
        "PK\x03\x04nodeprox",
        `--${boundary}--`,
        "",
      ].join("\r\n");
      return {
        body,
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
      };
    };
    const deniedUpload = multipart();
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${ownerChapterId}/upload`,
          headers: { cookie: uploaderCookie, ...deniedUpload.headers },
          payload: deniedUpload.body,
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
    const assignedUpload = multipart();
    const uploadResponse = await app.inject({
      method: "POST",
      url: `/chapters/${assignedChapterId}/upload`,
      headers: { cookie: secondUploaderCookie, ...assignedUpload.headers },
      payload: assignedUpload.body,
    });
    expect(uploadResponse.statusCode).toBe(201);
    const [uploadRow] = await database.db
      .select({ storageKey: uploads.storageKey })
      .from(uploads)
      .where(eq(uploads.chapterId, assignedChapterId));
    if (uploadRow)
      rmSync(join(process.cwd(), ".nodeprox-storage", uploadRow.storageKey), {
        force: true,
      });
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
  });
});
