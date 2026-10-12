import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { DrizzleChapterReplacementProcessingRepository } from "../../apps/api/src/modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import { DrizzleImageReplacementOperationRepository } from "../../apps/api/src/modules/images/infrastructure/persistence/drizzle/image-replacement-operation.repository.js";
import { DrizzleUploadRepository } from "../../apps/api/src/modules/uploads/infrastructure/persistence/drizzle/upload.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapters,
  domainEventOutbox,
  images,
  series,
  seriesAssignments,
  seriesCreationGrants,
  seriesOperationalHistory,
  seriesReactivationRequests,
  users,
} from "../../database/schema/index.js";
import { legacyStorageProfileId } from "../helpers/storage-execution.js";
import { insertImagesWithInitialVersions } from "./helpers/image-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const adminId = randomUUID();
const gestorId = randomUUID();
const uploaderId = randomUUID();
const seriesId = randomUUID();
const skeletonId = randomUUID();
const mediaSeriesId = randomUUID();
const raceSeriesId = randomUUID();
const unassignedSeriesId = randomUUID();
const reassignedSeriesId = randomUUID();
const chapterId = randomUUID();
const mediaChapterId = randomUUID();
const raceChapterId = randomUUID();
const activeChapterId = randomUUID();
const grantId = randomUUID();
const grantConsumedAt = new Date("2026-09-01T10:00:00.000Z");
const password = "series-lifecycle-integration-password";
const emails = {
  admin: `lifecycle-${adminId}@example.com`,
  gestor: `lifecycle-${gestorId}@example.com`,
  uploader: `lifecycle-${uploaderId}@example.com`,
};
let adminCookie = "";
let gestorCookie = "";
let uploaderCookie = "";

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  const header = response.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error("session-cookie-missing");
  return cookie;
}

beforeAll(async () => {
  const passwordHash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: adminId,
      email: emails.admin,
      passwordHash,
      status: "active",
      role: "admin",
    },
    {
      id: gestorId,
      email: emails.gestor,
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
  ]);
  await database.db.insert(series).values([
    {
      id: seriesId,
      title: "Lifecycle Test",
      slug: `lifecycle-${seriesId}`,
      createdBy: gestorId,
    },
    {
      id: skeletonId,
      title: "Lifecycle Skeleton",
      slug: `lifecycle-skeleton-${skeletonId}`,
      createdBy: gestorId,
    },
    {
      id: mediaSeriesId,
      title: "Lifecycle Media",
      slug: `lifecycle-media-${mediaSeriesId}`,
      createdBy: gestorId,
    },
    {
      id: raceSeriesId,
      title: "Lifecycle Race",
      slug: `lifecycle-race-${raceSeriesId}`,
      createdBy: gestorId,
    },
    {
      id: unassignedSeriesId,
      title: "Lifecycle Unassigned",
      slug: `lifecycle-unassigned-${unassignedSeriesId}`,
      createdBy: gestorId,
    },
    {
      id: reassignedSeriesId,
      title: "Lifecycle Reassigned",
      slug: `lifecycle-reassigned-${reassignedSeriesId}`,
      createdBy: gestorId,
    },
  ]);
  await database.db.insert(seriesAssignments).values([
    { seriesId, responsibleUserId: uploaderId, assignedBy: gestorId },
    { seriesId: skeletonId, responsibleUserId: gestorId, assignedBy: gestorId },
    {
      seriesId: mediaSeriesId,
      responsibleUserId: gestorId,
      assignedBy: gestorId,
    },
    {
      seriesId: raceSeriesId,
      responsibleUserId: gestorId,
      assignedBy: gestorId,
    },
    {
      seriesId: reassignedSeriesId,
      responsibleUserId: gestorId,
      assignedBy: gestorId,
    },
  ]);
  await database.db.insert(chapters).values({
    id: chapterId,
    seriesId: skeletonId,
    chapterNumber: 1,
    publicKey: "1",
    createdBy: gestorId,
  });
  await database.db.insert(chapters).values({
    id: mediaChapterId,
    seriesId: mediaSeriesId,
    chapterNumber: 1,
    publicKey: "1",
    createdBy: gestorId,
    status: "ready",
  });
  await database.db.insert(chapters).values({
    id: raceChapterId,
    seriesId: raceSeriesId,
    chapterNumber: 1,
    publicKey: "1",
    createdBy: gestorId,
  });
  await insertImagesWithInitialVersions(database.db, [
    {
      chapterId: mediaChapterId,
      filename: "page.webp",
      storageKey: `lifecycle/${mediaChapterId}/page.webp`,
      extension: "webp",
      contentType: "image/webp",
      sizeBytes: 10,
      sortOrder: 1,
      checksum: "lifecycle-test",
    },
  ]);
  await database.db.insert(seriesCreationGrants).values({
    id: grantId,
    displayCode: `NPX-TEST-${grantId}`,
    targetUserId: uploaderId,
    issuedVia: "web",
    issuedByUserId: adminId,
    status: "consumed",
    consumedAt: grantConsumedAt,
    consumedBySeriesId: skeletonId,
  });
  [adminCookie, gestorCookie, uploaderCookie] = await Promise.all([
    login(emails.admin),
    login(emails.gestor),
    login(emails.uploader),
  ]);
});

afterAll(async () => {
  await database.db.delete(chapters).where(eq(chapters.id, chapterId));
  await database.db.delete(images).where(eq(images.chapterId, mediaChapterId));
  await database.db.delete(chapters).where(eq(chapters.id, mediaChapterId));
  await database.db.delete(chapters).where(eq(chapters.id, raceChapterId));
  await database.db
    .delete(series)
    .where(
      inArray(series.id, [
        seriesId,
        skeletonId,
        mediaSeriesId,
        raceSeriesId,
        unassignedSeriesId,
        reassignedSeriesId,
      ]),
    );
  await database.db
    .delete(seriesCreationGrants)
    .where(eq(seriesCreationGrants.id, grantId));
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, [adminId, gestorId, uploaderId]));
  await database.db
    .delete(users)
    .where(inArray(users.id, [adminId, gestorId, uploaderId]));
  await app.close();
  await database.sql.end();
});

describe("Series operational lifecycle", () => {
  it("lets an uploader view inactive Series without an assignment", async () => {
    const deactivate = await app.inject({
      method: "POST",
      url: `/series/${unassignedSeriesId}/deactivate`,
      headers: { cookie: adminCookie },
      payload: { reason: "hiatus", reasonDetail: "Pausa temporal" },
    });
    expect(deactivate.statusCode).toBe(200);

    const activeList = await app.inject({
      method: "GET",
      url: "/series",
      headers: { cookie: uploaderCookie },
    });
    expect(
      activeList
        .json<Array<{ id: string }>>()
        .some((item) => item.id === unassignedSeriesId),
    ).toBe(false);

    const inactiveList = await app.inject({
      method: "GET",
      url: "/series?operationalState=inactive",
      headers: { cookie: uploaderCookie },
    });
    expect(inactiveList.statusCode).toBe(200);
    expect(
      inactiveList
        .json<Array<{ id: string; inactiveReasonDetail: string | null }>>()
        .some(
          (item) =>
            item.id === unassignedSeriesId &&
            item.inactiveReasonDetail === "Pausa temporal",
        ),
    ).toBe(true);

    const detail = await app.inject({
      method: "GET",
      url: `/series/${unassignedSeriesId}`,
      headers: { cookie: uploaderCookie },
    });
    expect(detail.statusCode).toBe(200);

    const lifecycle = await app.inject({
      method: "GET",
      url: `/series/${unassignedSeriesId}/lifecycle`,
      headers: { cookie: uploaderCookie },
    });
    expect(lifecycle.statusCode).toBe(200);
    expect(lifecycle.json().history).toHaveLength(1);

    const capabilities = await app.inject({
      method: "GET",
      url: `/series/${unassignedSeriesId}/capabilities`,
      headers: { cookie: uploaderCookie },
    });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().capabilities).toContain(
      "series.reactivation.request",
    );

    const request = await app.inject({
      method: "POST",
      url: `/series/${unassignedSeriesId}/reactivation-requests`,
      headers: { cookie: uploaderCookie },
      payload: { note: "Puedo retomar esta serie" },
    });
    expect(request.statusCode).toBe(201);
    const requestId = request.json<{ reactivationRequestId: string }>()
      .reactivationRequestId;
    const approval = await app.inject({
      method: "POST",
      url: `/series/${unassignedSeriesId}/reactivation-requests/${requestId}/approve`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(approval.statusCode).toBe(200);
    const activeListAfterApproval = await app.inject({
      method: "GET",
      url: "/series",
      headers: { cookie: uploaderCookie },
    });
    expect(activeListAfterApproval.statusCode).toBe(200);
    const activeProjection =
      activeListAfterApproval.json<
        Array<{
          id: string;
          hasApprovedReactivationRequest: boolean;
          lastApprovedAt: string | null;
        }>
      >();
    const reactivated = activeProjection.find(
      (item) => item.id === unassignedSeriesId,
    );
    expect(reactivated).toMatchObject({
      hasApprovedReactivationRequest: true,
    });
    expect(reactivated?.lastApprovedAt).toEqual(expect.any(String));
    const [assignment] = await database.db
      .select()
      .from(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, unassignedSeriesId));
    expect(assignment).toMatchObject({
      responsibleUserId: uploaderId,
      assignedBy: adminId,
    });
  });

  it("transfers responsibility to the requesting uploader when approval reactivates a previously assigned series", async () => {
    const deactivate = await app.inject({
      method: "POST",
      url: `/series/${reassignedSeriesId}/deactivate`,
      headers: { cookie: adminCookie },
      payload: { reason: "hiatus" },
    });
    expect(deactivate.statusCode).toBe(200);
    const request = await app.inject({
      method: "POST",
      url: `/series/${reassignedSeriesId}/reactivation-requests`,
      headers: { cookie: uploaderCookie },
      payload: { note: "Puedo continuar esta serie" },
    });
    expect(request.statusCode).toBe(201);
    const requestId = request.json<{ reactivationRequestId: string }>()
      .reactivationRequestId;
    const approval = await app.inject({
      method: "POST",
      url: `/series/${reassignedSeriesId}/reactivation-requests/${requestId}/approve`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(approval.statusCode).toBe(200);
    const [assignment] = await database.db
      .select()
      .from(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, reassignedSeriesId));
    expect(assignment).toMatchObject({
      responsibleUserId: uploaderId,
      assignedBy: adminId,
    });
    const approvalRequestId = approval.headers["x-request-id"];
    const correlatedAudits = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, reassignedSeriesId));
    for (const action of [
      "series.assignment.changed_on_reactivation",
      "series.reactivation.approved",
      "series.lifecycle.reactivated",
    ]) {
      const row = correlatedAudits.find((audit) => audit.action === action);
      expect(row?.requestId).toBe(approvalRequestId);
      expect(row?.requestId).not.toBe(requestId);
      expect(row?.metadata).toMatchObject({ reactivationRequestId: requestId });
    }
    const activeList = await app.inject({
      method: "GET",
      url: "/series",
      headers: { cookie: uploaderCookie },
    });
    expect(
      activeList
        .json<Array<{ id: string }>>()
        .some((item) => item.id === reassignedSeriesId),
    ).toBe(true);
  });

  it("defaults existing Series to active and enforces database consistency", async () => {
    const [row] = await database.db
      .select()
      .from(series)
      .where(eq(series.id, seriesId));
    expect(row?.operationalState).toBe("active");
    expect(row?.inactiveReason).toBeNull();
    await expect(
      database.db
        .update(series)
        .set({
          operationalState: "inactive",
          inactiveReason: "other",
          inactiveReasonDetail: " ",
        })
        .where(eq(series.id, seriesId)),
    ).rejects.toThrow();
  });

  it("blocks deactivation and hard delete while Chapter work is active", async () => {
    await database.db.insert(chapters).values({
      id: activeChapterId,
      seriesId,
      chapterNumber: 3,
      publicKey: "3",
      createdBy: gestorId,
      status: "uploading",
    });
    const deactivate = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/deactivate`,
      headers: { cookie: adminCookie },
      payload: { reason: "hiatus" },
    });
    expect(deactivate.statusCode).toBe(409);
    expect(deactivate.json<{ code: string }>().code).toBe(
      "series-active-operation",
    );
    const remove = await app.inject({
      method: "DELETE",
      url: `/series/${seriesId}`,
      headers: { cookie: adminCookie },
    });
    expect(remove.statusCode).toBe(409);
    expect(remove.json<{ code: string }>().code).toBe(
      "series-active-operation",
    );
    await database.db.delete(chapters).where(eq(chapters.id, activeChapterId));
  });

  it("deactivates, blocks direct writes, accepts one contextual request and approves it", async () => {
    const deactivate = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/deactivate`,
      headers: { cookie: adminCookie },
      payload: { reason: "hiatus" },
    });
    expect(deactivate.statusCode).toBe(200);
    expect(
      (
        await database.db.select().from(series).where(eq(series.id, seriesId))
      )[0]?.operationalState,
    ).toBe("inactive");
    const activeList = await app.inject({
      method: "GET",
      url: "/series",
      headers: { cookie: gestorCookie },
    });
    expect(
      activeList
        .json<Array<{ id: string }>>()
        .some((item) => item.id === seriesId),
    ).toBe(false);
    const inactiveList = await app.inject({
      method: "GET",
      url: "/series?operationalState=inactive",
      headers: { cookie: uploaderCookie },
    });
    expect(
      inactiveList
        .json<Array<{ id: string }>>()
        .some((item) => item.id === seriesId),
    ).toBe(true);
    const update = await app.inject({
      method: "PATCH",
      url: `/series/${seriesId}`,
      headers: { cookie: adminCookie },
      payload: { title: "Should not persist" },
    });
    expect(update.statusCode).toBe(409);
    expect(update.json<{ code: string }>().code).toBe("series-inactive");
    const chapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: adminCookie },
      payload: { chapterNumber: 7 },
    });
    expect(chapter.statusCode).toBe(409);
    expect(chapter.json<{ code: string }>().code).toBe("series-inactive");
    const request = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/reactivation-requests`,
      headers: { cookie: uploaderCookie },
      payload: { note: "Disponible para continuar" },
    });
    expect(request.statusCode).toBe(201);
    const requestId = request.json<{ reactivationRequestId: string }>()
      .reactivationRequestId;
    const lifecycle = await app.inject({
      method: "GET",
      url: `/series/${seriesId}/lifecycle`,
      headers: { cookie: uploaderCookie },
    });
    expect(lifecycle.statusCode).toBe(200);
    expect(
      lifecycle.json<{ requests: Array<{ requestedByLabel: string }> }>()
        .requests[0]?.requestedByLabel,
    ).toBe(emails.uploader);
    const requestEvents = await database.db
      .select()
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.aggregateId, seriesId));
    expect(requestEvents).toHaveLength(1);
    expect(requestEvents[0]).toMatchObject({
      eventType: "series.reactivation.requested",
      originRequestId: request.headers["x-request-id"],
      actorUserId: uploaderId,
      payload: {
        targetUserIds: expect.arrayContaining([adminId]),
        requesterLabel: emails.uploader,
        seriesTitle: "Lifecycle Test",
      },
    });
    const duplicate = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/reactivation-requests`,
      headers: { cookie: uploaderCookie },
      payload: {},
    });
    expect(duplicate.statusCode).toBe(409);
    const approve = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/reactivation-requests/${requestId}/approve`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(approve.statusCode).toBe(200);
    const [active] = await database.db
      .select()
      .from(series)
      .where(eq(series.id, seriesId));
    expect(active?.operationalState).toBe("active");
    expect(active?.inactiveReason).toBeNull();
    const history = await database.db
      .select()
      .from(seriesOperationalHistory)
      .where(eq(seriesOperationalHistory.seriesId, seriesId));
    expect(history).toHaveLength(2);
    expect(history[0]?.responsibleUserIdAtEvent).toBe(uploaderId);
    const [reviewed] = await database.db
      .select()
      .from(seriesReactivationRequests)
      .where(eq(seriesReactivationRequests.id, requestId));
    expect(reviewed?.status).toBe("approved");
  });

  it("deletes an empty Chapter skeleton atomically", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/series/${skeletonId}`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(204);
    expect(
      await database.db
        .select()
        .from(chapters)
        .where(eq(chapters.id, chapterId)),
    ).toHaveLength(0);
    expect(
      await database.db.select().from(series).where(eq(series.id, skeletonId)),
    ).toHaveLength(0);
    const [grant] = await database.db
      .select()
      .from(seriesCreationGrants)
      .where(eq(seriesCreationGrants.id, grantId));
    expect(grant?.status).toBe("consumed");
    expect(grant?.consumedAt).toEqual(grantConsumedAt);
    expect(grant?.consumedBySeriesId).toBeNull();
  });

  it("keeps a rejected request inactive and cancels a pending request on direct reactivation", async () => {
    const deactivate = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/deactivate`,
      headers: { cookie: adminCookie },
      payload: { reason: "other", reasonDetail: "Revisión editorial" },
    });
    expect(deactivate.statusCode).toBe(200);
    const first = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/reactivation-requests`,
      headers: { cookie: gestorCookie },
      payload: {},
    });
    expect(first.statusCode).toBe(201);
    const firstId = first.json<{ reactivationRequestId: string }>()
      .reactivationRequestId;
    const rejected = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/reactivation-requests/${firstId}/reject`,
      headers: { cookie: adminCookie },
      payload: { resolutionNote: "Aún no" },
    });
    expect(rejected.statusCode).toBe(200);
    const [rejectionAudit] = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, "series.reactivation.rejected"));
    expect(rejectionAudit?.requestId).toBe(rejected.headers["x-request-id"]);
    expect(rejectionAudit?.requestId).not.toBe(firstId);
    expect(rejectionAudit?.metadata).toMatchObject({
      reactivationRequestId: firstId,
    });
    expect(
      (
        await database.db.select().from(series).where(eq(series.id, seriesId))
      )[0]?.operationalState,
    ).toBe("inactive");
    const second = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/reactivation-requests`,
      headers: { cookie: uploaderCookie },
      payload: {},
    });
    expect(second.statusCode).toBe(201);
    const secondId = second.json<{ reactivationRequestId: string }>()
      .reactivationRequestId;
    const direct = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/reactivate`,
      headers: { cookie: adminCookie },
      payload: {},
    });
    expect(direct.statusCode).toBe(200);
    const [cancelled] = await database.db
      .select()
      .from(seriesReactivationRequests)
      .where(eq(seriesReactivationRequests.id, secondId));
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.reviewedBy).toBe(adminId);
  });

  it("blocks destructive deletion of media history", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: `/series/${mediaSeriesId}`,
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("series-has-media");
    expect(
      await database.db
        .select()
        .from(images)
        .where(eq(images.chapterId, mediaChapterId)),
    ).toHaveLength(1);
  });

  it("blocks direct replacement creation beneath an inactive Series", async () => {
    const deactivate = await app.inject({
      method: "POST",
      url: `/series/${mediaSeriesId}/deactivate`,
      headers: { cookie: adminCookie },
      payload: { reason: "completed" },
    });
    expect(deactivate.statusCode).toBe(200);
    const chapterReplacements =
      new DrizzleChapterReplacementProcessingRepository(database.db);
    await expect(
      chapterReplacements.createPending({
        id: randomUUID(),
        chapterId: mediaChapterId,
        requestedByUserId: gestorId,
        candidateZipStorageKey: `test/${randomUUID()}.zip`,
        storageProfileId: legacyStorageProfileId,
        originalFilename: "replacement.zip",
        contentType: "application/zip",
        sizeBytes: 10,
      }),
    ).resolves.toEqual({ outcome: "inactive" });
    const [image] = await database.db
      .select({ id: images.id })
      .from(images)
      .where(eq(images.chapterId, mediaChapterId));
    if (!image) throw new Error("media-fixture-missing");
    const imageReplacements = new DrizzleImageReplacementOperationRepository(
      database.db,
    );
    await expect(
      imageReplacements.create({
        id: randomUUID(),
        imageId: image.id,
        chapterId: mediaChapterId,
        requestedByUserId: gestorId,
        candidateStorageKey: `test/${randomUUID()}.webp`,
        storageProfileId: legacyStorageProfileId,
        originalFilename: "replacement.webp",
        contentType: "image/webp",
        sizeBytes: 10,
        status: "pending_upload",
      }),
    ).resolves.toEqual({ outcome: "inactive" });
  });

  it("rejects otherwise authorized direct API writes to inactive Series", async () => {
    const [image] = await database.db
      .select({ id: images.id })
      .from(images)
      .where(eq(images.chapterId, mediaChapterId));
    if (!image) throw new Error("media-fixture-missing");
    const transfer = {
      filename: "chapter.zip",
      contentType: "application/zip",
      sizeBytes: 10,
    };
    const requests = [
      {
        method: "PATCH",
        url: `/chapters/${mediaChapterId}`,
        payload: { title: "Blocked" },
      },
      { method: "DELETE", url: `/chapters/${mediaChapterId}` },
      {
        method: "PUT",
        url: `/series/${mediaSeriesId}/responsible`,
        payload: { responsibleUserId: gestorId },
      },
      {
        method: "POST",
        url: `/chapters/${mediaChapterId}/permissions`,
        payload: { userId: uploaderId, permissions: ["chapters.read"] },
      },
      {
        method: "DELETE",
        url: `/chapters/${mediaChapterId}/permissions/${uploaderId}`,
      },
      {
        method: "POST",
        url: `/chapters/${mediaChapterId}/uploads/initiate`,
        payload: transfer,
      },
      {
        method: "POST",
        url: `/chapters/${mediaChapterId}/replacement-session`,
        payload: transfer,
      },
      {
        method: "POST",
        url: `/chapters/${mediaChapterId}/images/${image.id}/replacement-session`,
        payload: {
          ...transfer,
          filename: "image.webp",
          contentType: "image/webp",
        },
      },
    ] as const;
    for (const request of requests) {
      const response = await app.inject({
        ...request,
        headers: { cookie: adminCookie },
      });
      expect(response.statusCode, `${request.method} ${request.url}`).toBe(409);
      expect(
        response.json<{ code: string }>().code,
        `${request.method} ${request.url}`,
      ).toBe("series-inactive");
    }
  });

  it("serializes deactivation against new upload creation", async () => {
    const uploadId = randomUUID();
    const uploads = new DrizzleUploadRepository(database.db);
    const [deactivation, startedUpload] = await Promise.allSettled([
      app.inject({
        method: "POST",
        url: `/series/${raceSeriesId}/deactivate`,
        headers: { cookie: adminCookie },
        payload: { reason: "hiatus" },
      }),
      uploads.createPending({
        id: uploadId,
        chapterId: raceChapterId,
        storageKey: `uploads/${raceSeriesId}/${raceChapterId}/${uploadId}.zip`,
        storageProfileId: legacyStorageProfileId,
        originalFilename: "race.zip",
        contentType: "application/zip",
        sizeBytes: 1,
        createdBy: gestorId,
      }),
    ]);
    expect(deactivation.status).toBe("fulfilled");
    const response =
      deactivation.status === "fulfilled" ? deactivation.value : null;
    expect([200, 409]).toContain(response?.statusCode);
    if (response?.statusCode === 200) {
      expect(startedUpload.status).toBe("fulfilled");
      if (startedUpload.status === "fulfilled")
        expect(startedUpload.value).toEqual({ outcome: "inactive" });
      const [chapter] = await database.db
        .select()
        .from(chapters)
        .where(eq(chapters.id, raceChapterId));
      expect(chapter?.status).toBe("draft");
    } else {
      expect(startedUpload.status).toBe("fulfilled");
      if (
        startedUpload.status === "fulfilled" &&
        startedUpload.value &&
        !("outcome" in startedUpload.value)
      )
        expect(startedUpload.value.id).toBe(uploadId);
      expect(response?.json<{ code: string }>().code).toBe(
        "series-active-operation",
      );
      expect(await uploads.removePending(uploadId)).toBe(true);
    }
  });
});
