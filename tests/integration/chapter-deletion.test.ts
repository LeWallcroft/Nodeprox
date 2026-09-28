import { eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, inject, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { ChapterDeletionService } from "../../apps/worker/src/deletion/application/chapter-deletion.service.js";
import { DrizzleChapterDeletionRepository } from "../../apps/worker/src/deletion/infrastructure/persistence/drizzle/chapter-deletion.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterDeletionOutbox,
  chapters,
  series,
  uploads,
  users,
} from "../../database/schema/index.js";
import type { StoragePort } from "@nodeprox/storage/port";
import { insertImagesWithInitialVersions } from "./helpers/image-fixture.js";
import { legacyStorageExecution } from "../helpers/storage-execution.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const ownerId = randomUUID();
const outsiderId = randomUUID();
const seriesId = randomUUID();
const chapterId = randomUUID();
const uploadId = randomUUID();
const imageId = randomUUID();
const password = "chapter-deletion-test";
const ownerEmail = `delete-owner-${ownerId}@example.com`;
const outsiderEmail = `delete-outsider-${outsiderId}@example.com`;
const seriesSlug = `deletion-${seriesId}`;
const imageKey = `Media/${seriesSlug}/25/01.webp`;
const sourceKey = `uploads/${seriesId}/${chapterId}/${uploadId}.zip`;
const lifecycleChapterIds: string[] = [];

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("expected-session-cookie");
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
  const passwordHash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: ownerId,
      email: ownerEmail,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: outsiderId,
      email: outsiderEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
  await database.db.insert(series).values({
    id: seriesId,
    title: "Deletion Series",
    slug: seriesSlug,
    createdBy: ownerId,
  });
  await database.db.insert(chapters).values({
    id: chapterId,
    seriesId,
    chapterNumber: 25,
    publicKey: "25",
    status: "ready",
    createdBy: ownerId,
  });
  await database.db.insert(uploads).values({
    id: uploadId,
    chapterId,
    storageKey: sourceKey,
    storageProfileId: "00000000-0000-4000-8000-000000000001",
    originalFilename: "25.zip",
    contentType: "application/zip",
    sizeBytes: 128,
    status: "uploaded",
    createdBy: ownerId,
  });
  await insertImagesWithInitialVersions(database.db, [
    {
      id: imageId,
      chapterId,
      filename: "01.webp",
      storageKey: imageKey,
      extension: "webp",
      contentType: "image/webp",
      sizeBytes: 64,
      sortOrder: 1,
      checksum: "a".repeat(64),
    },
  ]);
});

afterAll(async () => {
  if (lifecycleChapterIds.length > 0) {
    await database.db
      .delete(chapterDeletionOutbox)
      .where(inArray(chapterDeletionOutbox.chapterId, lifecycleChapterIds));
    await database.db
      .delete(chapters)
      .where(inArray(chapters.id, lifecycleChapterIds));
  }
  await database.db
    .delete(auditLogs)
    .where(eq(auditLogs.resourceId, chapterId));
  await database.db
    .delete(chapterDeletionOutbox)
    .where(eq(chapterDeletionOutbox.chapterId, chapterId));
  await database.db.delete(chapters).where(eq(chapters.id, chapterId));
  await database.db.delete(series).where(eq(series.id, seriesId));
  await database.db
    .delete(users)
    .where(inArray(users.id, [ownerId, outsiderId]));
  await app.close();
  await database.sql.end();
});

describe("durable Chapter deletion", () => {
  it.each(["draft", "uploading", "uploaded", "ready", "failed"] as const)(
    "transitions %s to deleting and creates the outbox only after validation",
    async (status) => {
      const id = randomUUID();
      lifecycleChapterIds.push(id);
      await database.db.insert(chapters).values({
        id,
        seriesId,
        chapterNumber: 100 + lifecycleChapterIds.length,
        publicKey: `delete-${lifecycleChapterIds.length}`,
        status,
        createdBy: ownerId,
      });
      const response = await app.inject({
        method: "DELETE",
        url: `/chapters/${id}`,
        headers: { cookie: await login(ownerEmail) },
      });
      expect(response.statusCode).toBe(204);
      const [chapter] = await database.db
        .select({ status: chapters.status })
        .from(chapters)
        .where(eq(chapters.id, id));
      const [outbox] = await database.db
        .select({ id: chapterDeletionOutbox.id })
        .from(chapterDeletionOutbox)
        .where(eq(chapterDeletionOutbox.chapterId, id));
      expect(chapter?.status).toBe("deleting");
      expect(outbox).toBeDefined();
    },
  );

  it("rejects processing to deleting with a stable 409 and no outbox", async () => {
    const id = randomUUID();
    lifecycleChapterIds.push(id);
    await database.db.insert(chapters).values({
      id,
      seriesId,
      chapterNumber: 200,
      publicKey: "processing-delete",
      status: "processing",
      createdBy: ownerId,
    });
    const response = await app.inject({
      method: "DELETE",
      url: `/chapters/${id}`,
      headers: { cookie: await login(ownerEmail) },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "invalid-chapter-transition",
    });
    const [chapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, id));
    const [outbox] = await database.db
      .select({ id: chapterDeletionOutbox.id })
      .from(chapterDeletionOutbox)
      .where(eq(chapterDeletionOutbox.chapterId, id));
    expect(chapter?.status).toBe("processing");
    expect(outbox).toBeUndefined();
  });

  it("denies an unrelated actor without changing lifecycle", async () => {
    const denied = await app.inject({
      method: "DELETE",
      url: `/chapters/${chapterId}`,
      headers: { cookie: await login(outsiderEmail) },
    });
    expect(denied.statusCode).toBe(403);
    const [chapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    expect(chapter?.status).toBe("ready");
  });

  it("retains DB trace on B2 failure, retries idempotently, then finalizes", async () => {
    const requested = await app.inject({
      method: "DELETE",
      url: `/chapters/${chapterId}`,
      headers: { cookie: await login(ownerEmail) },
    });
    expect(requested.statusCode).toBe(204);
    const [request] = await database.db
      .select()
      .from(chapterDeletionOutbox)
      .where(eq(chapterDeletionOutbox.chapterId, chapterId));
    expect(request).toMatchObject({ status: "pending", requestedBy: ownerId });
    if (!request) throw new Error("expected-deletion-request");
    const [deleting] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    expect(deleting?.status).toBe("deleting");

    let failOnce = true;
    const remove = vi.fn(async (_key: string) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("temporary-b2-failure");
      }
    });
    const storage: StoragePort = {
      put: vi.fn(async (value) => ({
        key: value.key,
        sizeBytes: value.sizeBytes,
        contentType: value.contentType,
      })),
      get: vi.fn(async () => Readable.from([])),
      delete: remove,
      exists: vi.fn(async () => false),
    };
    const cleanup = new ChapterDeletionService(
      new DrizzleChapterDeletionRepository(database.db),
      legacyStorageExecution(storage),
    );
    await expect(
      cleanup.execute({ deletionId: request.id, chapterId }),
    ).rejects.toThrow("temporary-b2-failure");
    expect(
      await database.db
        .select()
        .from(chapters)
        .where(eq(chapters.id, chapterId)),
    ).toHaveLength(1);

    await cleanup.execute({ deletionId: request.id, chapterId });
    expect(new Set(remove.mock.calls.map(([key]) => key))).toEqual(
      new Set([imageKey, sourceKey]),
    );
    expect(
      await database.db
        .select()
        .from(chapters)
        .where(eq(chapters.id, chapterId)),
    ).toHaveLength(0);
    const [completed] = await database.db
      .select()
      .from(chapterDeletionOutbox)
      .where(eq(chapterDeletionOutbox.id, request.id));
    expect(completed?.status).toBe("completed");
    const deletionAudit = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, chapterId));
    expect(deletionAudit.some((row) => row.action === "chapter.deleted")).toBe(
      true,
    );
  });
});
