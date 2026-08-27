import {
  UploadTransferObjectNotFoundError,
  UploadTransferProviderError,
  type UploadTransferPort,
  type VerifiedUploadedObject,
} from "../../packages/storage/src/port.js";
import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
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

class FakeTransfer implements UploadTransferPort {
  readonly initiated: string[] = [];
  readonly objects = new Map<string, VerifiedUploadedObject>();
  verifyFailure: Error | null = null;
  private verificationStarted: (() => void) | null = null;
  private verificationRelease: Promise<void> | null = null;

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
    return {
      started: startedPromise,
      release: () => {
        this.verificationStarted = null;
        this.verificationRelease = null;
        release();
      },
    };
  }
}

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const transfer = new FakeTransfer();
const app = buildApp(
  { logger: false },
  {
    database: database.db,
    secureCookie: false,
    storage: { provider: "filesystem", uploadMaxSizeBytes: 8 },
    uploadTransfer: transfer,
  },
);
const password = "m4-upload-password";
const userId = randomUUID();
const otherId = randomUUID();
const email = `m4-upload-${userId}@example.com`;
const otherEmail = `m4-upload-other-${otherId}@example.com`;
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

async function initiate(cookie: string, chapterId: string, sizeBytes = 4) {
  return app.inject({
    method: "POST",
    url: `/chapters/${chapterId}/uploads/initiate`,
    headers: { cookie },
    payload: {
      filename: "chapter.zip",
      contentType: "application/zip",
      sizeBytes,
    },
  });
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
  ]);
});

afterAll(async () => {
  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, [userId, otherId]));
  await database.db.delete(uploads).where(eq(uploads.createdBy, userId));
  await database.db.delete(chapters).where(eq(chapters.createdBy, userId));
  await database.db.delete(series).where(eq(series.createdBy, userId));
  await database.db.delete(users).where(inArray(users.id, [userId, otherId]));
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

    const completeUrl = `/chapters/${chapterId}/uploads/${uploadId}/complete`;
    const missing = await app.inject({
      method: "POST",
      url: completeUrl,
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(409);
    expect(missing.json().code).toBe("upload-object-missing");

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
});
