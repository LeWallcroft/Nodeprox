import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
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
  chapters,
  processingOutbox,
  series,
  uploads,
  users,
} from "../../database/schema/index.js";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
  UploadTransferProviderError,
  type VerifiedUploadedObject,
} from "../../packages/storage/dist/port.js";
import {
  FakeDiscordSeriesChannelGateway,
  withM2DSeriesFixtures,
} from "./helpers/discord-series-channel-fixture.js";

class FakeTransfer implements UploadTransferPort {
  readonly initiated: string[] = [];
  readonly objects = new Map<string, VerifiedUploadedObject>();
  verifyFailure: Error | null = null;
  private verificationStarted: (() => void) | null = null;
  private verificationRelease: Promise<void> | null = null;
  private releaseVerificationGate: (() => void) | null = null;

  async initiate(input: { key: string }) {
    this.initiated.push(input.key);
    return {
      mode: "single" as const,
      method: "PUT" as const,
      url: `https://s3.example.test/${encodeURIComponent(input.key)}?signature=temporary`,
      headers: { "content-type": "application/zip" },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async verify(input: { key: string }) {
    this.verificationStarted?.();
    if (this.verificationRelease) await this.verificationRelease;
    if (this.verifyFailure) {
      const failure = this.verifyFailure;
      this.verifyFailure = null;
      throw failure;
    }
    const object = this.objects.get(input.key);
    if (!object) throw new UploadTransferObjectNotFoundError();
    return object;
  }

  async abort(input: { key: string }) {
    this.objects.delete(input.key);
  }

  blockVerification() {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    this.verificationStarted = started;
    this.verificationRelease = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.releaseVerificationGate = release;
    return {
      started: startedPromise,
      release: () => this.releaseBlockedVerification(),
    };
  }

  releaseBlockedVerification() {
    const release = this.releaseVerificationGate;
    this.releaseVerificationGate = null;
    this.verificationStarted = null;
    this.verificationRelease = null;
    release?.();
  }
}

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const transfer = new FakeTransfer();
const app = withM2DSeriesFixtures(
  buildApp(
    { logger: false },
    {
      database: database.db,
      secureCookie: false,
      storage: { provider: "filesystem", uploadMaxSizeBytes: 8 },
      uploadTransfer: transfer,
      seriesChannelGateway: new FakeDiscordSeriesChannelGateway(),
    },
  ),
);
const password = "m4-upload-password";
const userId = randomUUID();
const otherId = randomUUID();
const replacementId = randomUUID();
const email = `m4-upload-${userId}@example.com`;
const otherEmail = `m4-upload-other-${otherId}@example.com`;
const replacementEmail = `m4-upload-replacement-${replacementId}@example.com`;
const hasher = new Argon2PasswordHasher();

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

async function login(targetEmail = email): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email: targetEmail, password },
  });
  expect(response.statusCode).toBe(204);
  return cookieValue(response.headers["set-cookie"]);
}

async function createChapter(cookie: string, chapterNumber: number) {
  const createdSeries = await app.inject({
    method: "POST",
    url: "/series",
    headers: { cookie },
    payload: {
      title: `Upload Series ${chapterNumber}`,
      slug: `upload-${userId}-${chapterNumber}`,
    },
  });
  const seriesId = createdSeries.json().id as string;
  const createdChapter = await app.inject({
    method: "POST",
    url: `/series/${seriesId}/chapters`,
    headers: { cookie },
    payload: { chapterNumber: 1 },
  });
  return createdChapter.json().id as string;
}

async function initiate(
  cookie: string,
  chapterId: string,
  sizeBytes = 4,
  contentType = "application/zip",
  filename = "chapter.zip",
) {
  return app.inject({
    method: "POST",
    url: `/chapters/${chapterId}/uploads/initiate`,
    headers: { cookie },
    payload: {
      filename,
      contentType,
      sizeBytes,
    },
  });
}

async function seriesIdForChapter(chapterId: string): Promise<string> {
  const [chapter] = await database.db
    .select({ seriesId: chapters.seriesId })
    .from(chapters)
    .where(eq(chapters.id, chapterId));
  if (!chapter) throw new Error("Expected chapter series");
  return chapter.seriesId;
}

async function assignResponsible(
  ownerCookie: string,
  chapterId: string,
  responsibleUserId: string,
) {
  const response = await app.inject({
    method: "PUT",
    url: `/series/${await seriesIdForChapter(chapterId)}/responsible`,
    headers: { cookie: ownerCookie },
    payload: { responsibleUserId },
  });
  expect(response.statusCode).toBe(200);
  return response;
}

async function returnResponsibilityToOwner(
  ownerCookie: string,
  chapterId: string,
) {
  return app.inject({
    method: "DELETE",
    url: `/series/${await seriesIdForChapter(chapterId)}/uploader`,
    headers: { cookie: ownerCookie },
  });
}

async function prepareAssignedUpload(chapterNumber: number) {
  const ownerCookie = await login();
  const uploaderCookie = await login(otherEmail);
  const chapterId = await createChapter(ownerCookie, chapterNumber);
  await assignResponsible(ownerCookie, chapterId, otherId);
  const initiated = await initiate(uploaderCookie, chapterId);
  expect(initiated.statusCode).toBe(201);
  const uploadId = initiated.json().uploadId as string;
  const [upload] = await database.db
    .select()
    .from(uploads)
    .where(eq(uploads.id, uploadId));
  if (!upload) throw new Error("Expected pending upload");
  transfer.objects.set(upload.storageKey, {
    key: upload.storageKey,
    sizeBytes: upload.sizeBytes,
    contentType: upload.contentType,
  });
  return { ownerCookie, uploaderCookie, chapterId, uploadId, upload };
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for lock");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  const passwordHash = await hasher.hash(password);
  await database.db.insert(users).values([
    { id: userId, email, passwordHash, status: "active", role: "gestor" },
    {
      id: otherId,
      email: otherEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
    {
      id: replacementId,
      email: replacementEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
});

afterEach(() => {
  transfer.releaseBlockedVerification();
});

afterAll(async () => {
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, [userId, otherId, replacementId]));
  await database.db.delete(uploads).where(eq(uploads.createdBy, userId));
  await database.db.delete(chapters).where(eq(chapters.createdBy, userId));
  await database.db.delete(series).where(eq(series.createdBy, userId));
  await database.db
    .delete(users)
    .where(inArray(users.id, [userId, otherId, replacementId]));
  await app.close();
  await database.sql.end();
});

describe("direct chapter upload transfer", () => {
  it("validates metadata and authorization before issuing a grant", async () => {
    const unauthenticated = await app.inject({
      method: "POST",
      url: `/chapters/${randomUUID()}/uploads/initiate`,
      payload: {
        filename: "chapter.zip",
        contentType: "application/zip",
        sizeBytes: 4,
      },
    });
    expect(unauthenticated.statusCode).toBe(401);

    const cookie = await login();
    const chapterId = await createChapter(cookie, 1);
    expect((await initiate(cookie, chapterId, 0)).statusCode).toBe(422);
    expect((await initiate(cookie, chapterId, 9)).statusCode).toBe(413);
    expect(
      (await initiate(await login(otherEmail), chapterId, 4)).statusCode,
    ).toBe(403);
    for (const [index, contentType] of [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "application/x-msdownload",
    ].entries()) {
      const rejectedChapterId = await createChapter(cookie, 20 + index);
      expect(
        (await initiate(cookie, rejectedChapterId, 4, contentType)).statusCode,
      ).toBe(415);
    }
    const alternateMimeChapterId = await createChapter(cookie, 30);
    const alternateMime = await initiate(
      cookie,
      alternateMimeChapterId,
      4,
      "  Application/X-Zip-Compressed  ",
      "24.zip",
    );
    expect(alternateMime.statusCode).toBe(201);
    expect(alternateMime.json().transfer.headers).toMatchObject({
      "content-type": "application/zip",
    });
    const [alternateMimeUpload] = await database.db
      .select({
        contentType: uploads.contentType,
        originalFilename: uploads.originalFilename,
      })
      .from(uploads)
      .where(eq(uploads.id, alternateMime.json().uploadId as string));
    expect(alternateMimeUpload).toEqual({
      contentType: "application/zip",
      originalFilename: "24.zip",
    });
    const forged = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/uploads/initiate`,
      headers: { cookie },
      payload: {
        filename: "chapter.zip",
        contentType: "application/zip",
        sizeBytes: 4,
        storageKey: "../../secrets.zip",
      },
    });
    expect(forged.statusCode).toBe(422);
  });

  it("keeps initiate pending and completes only after verified HEAD metadata", async () => {
    const cookie = await login();
    const chapterId = await createChapter(cookie, 2);
    const initiated = await initiate(cookie, chapterId);
    expect(initiated.statusCode).toBe(201);
    expect(initiated.json()).toMatchObject({ status: "pending", sizeBytes: 4 });
    expect(initiated.body).not.toContain("B2_APPLICATION_KEY");
    expect(initiated.body).not.toContain("application-secret");

    const uploadId = initiated.json().uploadId as string;
    const [pendingRow] = await database.db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    expect(pendingRow).toMatchObject({ status: "pending", sizeBytes: 4 });
    const [uploadingChapter] = await database.db
      .select()
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    expect(uploadingChapter?.status).toBe("uploading");
    const [initiatedAudit] = await database.db
      .select({
        action: auditLogs.action,
        result: auditLogs.result,
        metadata: auditLogs.metadata,
      })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceId, chapterId),
          eq(auditLogs.action, "chapter.upload.initiated"),
        ),
      );
    expect(initiatedAudit).toMatchObject({
      action: "chapter.upload.initiated",
      result: null,
      metadata: { result: "pending" },
    });

    const completeUrl = `/chapters/${chapterId}/uploads/${uploadId}/complete`;
    const missing = await app.inject({
      method: "POST",
      url: completeUrl,
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().code).toBe("upload-object-missing");
    const [uploadAfterMissing] = await database.db
      .select({ status: uploads.status })
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    const [chapterAfterMissing] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    expect(uploadAfterMissing?.status).toBe("pending");
    expect(chapterAfterMissing?.status).not.toBe("uploaded");
    expect(
      await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resourceId, chapterId),
            eq(auditLogs.action, "chapter.upload.completed"),
            eq(auditLogs.result, "success"),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await database.db
        .select({ result: auditLogs.result })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resourceId, chapterId),
            eq(auditLogs.action, "chapter.upload.completed"),
            eq(auditLogs.result, "failed"),
          ),
        ),
    ).toMatchObject([{ result: "failed" }]);

    transfer.objects.set(pendingRow?.storageKey ?? "", {
      key: pendingRow?.storageKey ?? "",
      sizeBytes: 3,
      contentType: "application/zip",
    });
    const mismatch = await app.inject({
      method: "POST",
      url: completeUrl,
      headers: { cookie },
    });
    expect(mismatch.statusCode).toBe(422);

    transfer.objects.set(pendingRow?.storageKey ?? "", {
      key: pendingRow?.storageKey ?? "",
      sizeBytes: 4,
      contentType: "application/zip",
      etag: "etag-1",
    });
    const completed = await app.inject({
      method: "POST",
      url: completeUrl,
      headers: { cookie },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      status: "uploaded",
      sizeBytes: 4,
    });
    const completedAudits = await database.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceId, chapterId),
          eq(auditLogs.action, "chapter.upload.completed"),
          eq(auditLogs.result, "success"),
        ),
      );
    expect(completedAudits).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: "POST",
          url: completeUrl,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      await database.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.resourceId, chapterId),
            eq(auditLogs.action, "chapter.upload.completed"),
            eq(auditLogs.result, "success"),
          ),
        ),
    ).toHaveLength(1);
    const [intent] = await database.db
      .select()
      .from(processingOutbox)
      .where(eq(processingOutbox.uploadId, uploadId));
    expect(intent).toMatchObject({ uploadId, status: "pending" });
  });

  it("aborts consistently and sanitizes provider failures", async () => {
    const cookie = await login();
    const abortChapterId = await createChapter(cookie, 3);
    const initiated = await initiate(cookie, abortChapterId);
    const uploadId = initiated.json().uploadId as string;
    const aborted = await app.inject({
      method: "POST",
      url: `/chapters/${abortChapterId}/uploads/${uploadId}/abort`,
      headers: { cookie },
    });
    expect(aborted.statusCode).toBe(204);
    const [chapter] = await database.db
      .select()
      .from(chapters)
      .where(eq(chapters.id, abortChapterId));
    expect(chapter?.status).toBe("draft");

    const failureChapterId = await createChapter(cookie, 4);
    const failureInitiated = await initiate(cookie, failureChapterId);
    transfer.verifyFailure = new UploadTransferProviderError({
      cause: new Error("SignatureDoesNotMatch application-secret"),
    });
    const failure = await app.inject({
      method: "POST",
      url: `/chapters/${failureChapterId}/uploads/${failureInitiated.json().uploadId}/complete`,
      headers: { cookie },
    });
    expect(failure.statusCode).toBe(503);
    expect(failure.json().code).toBe("upload-provider-unavailable");
    expect(failure.body).not.toContain("SignatureDoesNotMatch");
    expect(failure.body).not.toContain("application-secret");
  });

  it("serializes complete against abort across concurrent requests", async () => {
    const cookie = await login();
    const chapterId = await createChapter(cookie, 5);
    const initiated = await initiate(cookie, chapterId);
    const uploadId = initiated.json().uploadId as string;
    const [pendingRow] = await database.db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    transfer.objects.set(pendingRow?.storageKey ?? "", {
      key: pendingRow?.storageKey ?? "",
      sizeBytes: 4,
      contentType: "application/zip",
    });
    const gate = transfer.blockVerification();
    const completion = app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/uploads/${uploadId}/complete`,
      headers: { cookie },
    });
    await gate.started;
    const abort = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/uploads/${uploadId}/abort`,
      headers: { cookie },
    });
    expect(abort.statusCode).toBe(409);
    gate.release();
    expect((await completion).statusCode).toBe(200);
    expect(transfer.objects.has(pendingRow?.storageKey ?? "")).toBe(true);
  });

  it("lets a committed revocation win while B2 HEAD is in progress and keeps the orphan cleanable", async () => {
    const prepared = await prepareAssignedUpload(6);
    const gate = transfer.blockVerification();
    const completion = app.inject({
      method: "POST",
      url: `/chapters/${prepared.chapterId}/uploads/${prepared.uploadId}/complete`,
      headers: { cookie: prepared.uploaderCookie },
    });
    await gate.started;
    const revocation = await returnResponsibilityToOwner(
      prepared.ownerCookie,
      prepared.chapterId,
    );
    expect(revocation.statusCode).toBe(204);
    expect(revocation.body).toBe("");
    gate.release();

    const denied = await completion;
    expect(denied.statusCode).toBe(403);
    const [upload] = await database.db
      .select({ status: uploads.status })
      .from(uploads)
      .where(eq(uploads.id, prepared.uploadId));
    const [chapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, prepared.chapterId));
    expect(upload?.status).toBe("pending");
    expect(chapter?.status).toBe("uploading");
    expect(transfer.objects.has(prepared.upload.storageKey)).toBe(true);

    const cleanup = await app.inject({
      method: "POST",
      url: `/chapters/${prepared.chapterId}/uploads/${prepared.uploadId}/abort`,
      headers: { cookie: prepared.ownerCookie },
    });
    expect(cleanup.statusCode).toBe(204);
    expect(transfer.objects.has(prepared.upload.storageKey)).toBe(false);
  });

  it("treats uploader reassignment before finalization as revocation for the prior actor", async () => {
    const prepared = await prepareAssignedUpload(7);
    const gate = transfer.blockVerification();
    const completion = app.inject({
      method: "POST",
      url: `/chapters/${prepared.chapterId}/uploads/${prepared.uploadId}/complete`,
      headers: { cookie: prepared.uploaderCookie },
    });
    await gate.started;
    await assignResponsible(
      prepared.ownerCookie,
      prepared.chapterId,
      replacementId,
    );
    gate.release();

    const denied = await completion;
    expect(denied.statusCode).toBe(403);
    const [upload] = await database.db
      .select({ status: uploads.status })
      .from(uploads)
      .where(eq(uploads.id, prepared.uploadId));
    expect(upload?.status).toBe("pending");
  });

  it("revalidates and locks an active helper permission before publishing uploaded", async () => {
    const ownerCookie = await login();
    const helperCookie = await login(replacementEmail);
    const chapterId = await createChapter(ownerCookie, 10);
    const grant = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/permissions`,
      headers: { cookie: ownerCookie },
      payload: { userId: replacementId, permissions: ["images.upload"] },
    });
    expect(grant.statusCode).toBe(204);
    const initiated = await initiate(helperCookie, chapterId);
    expect(initiated.statusCode).toBe(201);
    const uploadId = initiated.json().uploadId as string;
    const [pending] = await database.db
      .select()
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    if (!pending) throw new Error("Expected helper upload");
    transfer.objects.set(pending.storageKey, {
      key: pending.storageKey,
      sizeBytes: pending.sizeBytes,
      contentType: pending.contentType,
    });
    const gate = transfer.blockVerification();
    const completion = app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/uploads/${uploadId}/complete`,
      headers: { cookie: helperCookie },
    });
    await gate.started;
    const revoked = await app.inject({
      method: "DELETE",
      url: `/chapters/${chapterId}/permissions/${replacementId}`,
      headers: { cookie: ownerCookie },
    });
    expect(revoked.statusCode).toBe(204);
    gate.release();
    expect((await completion).statusCode).toBe(403);
    const [upload] = await database.db
      .select({ status: uploads.status })
      .from(uploads)
      .where(eq(uploads.id, uploadId));
    expect(upload?.status).toBe("pending");
  });

  it("revalidates after revocation commits between preliminary authorization and claim", async () => {
    const prepared = await prepareAssignedUpload(8);
    let releaseLock!: () => void;
    let lockReady!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      lockReady = resolve;
    });
    const blocker = database.sql.begin(async (tx) => {
      await tx`select id from uploads where id = ${prepared.uploadId} for update`;
      lockReady();
      await held;
    });
    await ready;

    const completion = app.inject({
      method: "POST",
      url: `/chapters/${prepared.chapterId}/uploads/${prepared.uploadId}/complete`,
      headers: { cookie: prepared.uploaderCookie },
    });
    await waitUntil(async () => {
      const [row] = await database.sql<{ waiting: boolean }[]>`
        select exists (
          select 1
          from pg_stat_activity
          where wait_event_type = 'Lock'
            and query ilike '%update "uploads"%'
        ) as waiting
      `;
      return row?.waiting === true;
    });
    expect(
      (
        await returnResponsibilityToOwner(
          prepared.ownerCookie,
          prepared.chapterId,
        )
      ).statusCode,
    ).toBe(204);
    releaseLock();
    await blocker;

    const denied = await completion;
    expect(denied.statusCode).toBe(403);
    const [upload] = await database.db
      .select({ status: uploads.status })
      .from(uploads)
      .where(eq(uploads.id, prepared.uploadId));
    expect(upload?.status).toBe("pending");
  });

  it("serializes a concurrent revocation after final authority locks and commit", async () => {
    const prepared = await prepareAssignedUpload(9);
    let releaseOutbox!: () => void;
    let outboxLocked!: () => void;
    const held = new Promise<void>((resolve) => {
      releaseOutbox = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      outboxLocked = resolve;
    });
    const blocker = database.sql.begin(async (tx) => {
      await tx`lock table processing_outbox in access exclusive mode`;
      outboxLocked();
      await held;
    });
    await ready;

    const completion = app.inject({
      method: "POST",
      url: `/chapters/${prepared.chapterId}/uploads/${prepared.uploadId}/complete`,
      headers: { cookie: prepared.uploaderCookie },
    });
    await waitUntil(async () => {
      const [row] = await database.sql<{ waiting: boolean }[]>`
        select exists (
          select 1
          from pg_locks locks
          join pg_class relation on relation.oid = locks.relation
          where relation.relname = 'processing_outbox'
            and locks.granted = false
        ) as waiting
      `;
      return row?.waiting === true;
    });

    let revocationSettled = false;
    const revocation = returnResponsibilityToOwner(
      prepared.ownerCookie,
      prepared.chapterId,
    ).finally(() => {
      revocationSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(revocationSettled).toBe(false);
    releaseOutbox();
    await blocker;

    expect((await completion).statusCode).toBe(200);
    expect((await revocation).statusCode).toBe(204);
    const [upload] = await database.db
      .select({ status: uploads.status })
      .from(uploads)
      .where(eq(uploads.id, prepared.uploadId));
    expect(upload?.status).toBe("uploaded");
    const noLongerVisible = await app.inject({
      method: "GET",
      url: `/series/${await seriesIdForChapter(prepared.chapterId)}`,
      headers: { cookie: prepared.uploaderCookie },
    });
    expect(noLongerVisible.statusCode).toBe(403);
  });
});
