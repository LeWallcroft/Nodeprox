import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterReplacementItems,
  chapterReplacementOperations,
  chapterReplacementProcessingOutbox,
  chapters,
  images,
  imageVersions,
  mediaEffectOutbox,
  series,
  users,
} from "../../database/schema/index.js";
import {
  UploadTransferObjectNotFoundError,
  type UploadTransferPort,
  type VerifiedUploadedObject,
} from "../../packages/storage/dist/port.js";
import { insertImagesWithInitialVersions } from "./helpers/image-fixture.js";

class ReplacementTransfer implements UploadTransferPort {
  readonly initiated: Array<{
    key: string;
    contentType: string;
    sizeBytes: number;
  }> = [];
  readonly objects = new Map<string, VerifiedUploadedObject>();

  async initiate(input: {
    key: string;
    contentType: string;
    sizeBytes: number;
  }) {
    this.initiated.push(input);
    return {
      mode: "single" as const,
      method: "PUT" as const,
      url: "https://uploads.example.test/direct-put?signature=redacted",
      headers: { "content-type": input.contentType },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async verify(input: { key: string }) {
    const object = this.objects.get(input.key);
    if (!object) throw new UploadTransferObjectNotFoundError();
    return object;
  }

  async abort(): Promise<void> {}
}

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const transfer = new ReplacementTransfer();
const app = buildApp(
  { logger: false },
  {
    database: database.db,
    secureCookie: false,
    storage: { provider: "filesystem", uploadMaxSizeBytes: 1_000_000 },
    uploadTransfer: transfer,
  },
);
const ownerId = randomUUID();
const outsiderId = randomUUID();
const password = "chapter-replacement-http-password";
const ownerEmail = `chapter-replacement-owner-${ownerId}@example.com`;
const outsiderEmail = `chapter-replacement-outsider-${outsiderId}@example.com`;
const createdSeriesIds: string[] = [];
const createdChapterIds: string[] = [];

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  const cookie = response.headers["set-cookie"];
  if (!cookie) throw new Error("missing-session-cookie");
  const value = Array.isArray(cookie) ? cookie[0] : cookie;
  if (!value) throw new Error("missing-session-cookie");
  return value;
}

async function fixture() {
  const seriesId = randomUUID();
  const chapterId = randomUUID();
  const imageId = randomUUID();
  const slug = `chr4-${seriesId}`;
  const publicKey = `chapter-${chapterId}`;
  createdSeriesIds.push(seriesId);
  createdChapterIds.push(chapterId);
  await database.db
    .insert(series)
    .values({ id: seriesId, title: "CHR4", slug, createdBy: ownerId });
  await database.db.insert(chapters).values({
    id: chapterId,
    seriesId,
    chapterNumber: 1,
    publicKey,
    status: "ready",
    createdBy: ownerId,
  });
  await insertImagesWithInitialVersions(database.db, [
    {
      id: imageId,
      chapterId,
      filename: "old.jpg",
      storageKey: `Media/${slug}/${publicKey}/old.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 10,
      sortOrder: 1,
      checksum: "old-checksum",
    },
  ]);
  return { seriesId, chapterId, imageId, slug, publicKey };
}

async function prepare(cookie: string, chapterId: string) {
  return app.inject({
    method: "POST",
    url: `/chapters/${chapterId}/replacement-session`,
    headers: { cookie },
    payload: {
      filename: "chapter.zip",
      contentType: "application/zip",
      sizeBytes: 20,
    },
  });
}

async function uploadAndComplete(cookie: string, chapterId: string) {
  const prepared = await prepare(cookie, chapterId);
  expect(prepared.statusCode).toBe(201);
  const body = prepared.json<{ replacementId: string }>();
  const initiated = transfer.initiated.at(-1);
  if (!initiated) throw new Error("missing-upload-grant");
  transfer.objects.set(initiated.key, {
    ...initiated,
    etag: `etag-${body.replacementId}`,
  });
  const completed = await app.inject({
    method: "POST",
    url: `/chapters/${chapterId}/replacements/${body.replacementId}/complete`,
    headers: { cookie },
  });
  return { replacementId: body.replacementId, completed };
}

async function makeReady(input: {
  replacementId: string;
  chapterId: string;
  slug: string;
  publicKey: string;
}) {
  const itemId = randomUUID();
  const physicalFilename = `${itemId}.jpg`;
  await database.db.insert(chapterReplacementItems).values({
    id: itemId,
    operationId: input.replacementId,
    sortOrder: 1,
    candidateStorageKey: `Media/${input.slug}/${input.publicKey}/${physicalFilename}`,
    physicalFilename,
    originalFilename: "page-1.jpg",
    contentType: "image/jpeg",
    sizeBytes: 21,
    checksum: `checksum-${itemId}`,
    storedAt: new Date(),
  });
  await database.db
    .update(chapterReplacementOperations)
    .set({ status: "ready", updatedAt: new Date() })
    .where(eq(chapterReplacementOperations.id, input.replacementId));
}

beforeAll(async () => {
  const hash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: ownerId,
      email: ownerEmail,
      passwordHash: hash,
      status: "active",
      role: "gestor",
    },
    {
      id: outsiderId,
      email: outsiderEmail,
      passwordHash: hash,
      status: "active",
      role: "uploader",
    },
  ]);
});

afterAll(async () => {
  if (createdChapterIds.length) {
    await database.db
      .delete(mediaEffectOutbox)
      .where(
        inArray(
          mediaEffectOutbox.replacementOperationId,
          database.db
            .select({ id: chapterReplacementOperations.id })
            .from(chapterReplacementOperations)
            .where(
              inArray(
                chapterReplacementOperations.chapterId,
                createdChapterIds,
              ),
            ),
        ),
      );
    await database.db
      .delete(auditLogs)
      .where(
        and(
          eq(auditLogs.resourceType, "chapter"),
          inArray(auditLogs.resourceId, createdChapterIds),
        ),
      );
    await database.db
      .delete(chapterReplacementProcessingOutbox)
      .where(
        inArray(
          chapterReplacementProcessingOutbox.chapterId,
          createdChapterIds,
        ),
      );
    await database.db
      .delete(chapterReplacementOperations)
      .where(
        inArray(chapterReplacementOperations.chapterId, createdChapterIds),
      );
    await database.db
      .delete(images)
      .where(inArray(images.chapterId, createdChapterIds));
    await database.db
      .delete(chapters)
      .where(inArray(chapters.id, createdChapterIds));
  }
  if (createdSeriesIds.length)
    await database.db
      .delete(series)
      .where(inArray(series.id, createdSeriesIds));
  await database.db
    .delete(users)
    .where(inArray(users.id, [ownerId, outsiderId]));
  await app.close();
  await database.sql.end();
});

describe("CHR4 Chapter replacement HTTP workflow", () => {
  it("CHR4-HTTP-01/02/03 prepares safely, authorizes, and conflicts on second active operation", async () => {
    const target = await fixture();
    expect((await prepare("", target.chapterId)).statusCode).toBe(401);
    expect(
      (await prepare(await login(outsiderEmail), target.chapterId)).statusCode,
    ).toBe(403);
    const first = await prepare(await login(ownerEmail), target.chapterId);
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({
      chapterId: target.chapterId,
      upload: { method: "PUT" },
    });
    expect(first.json()).not.toHaveProperty("candidateZipStorageKey");
    expect(
      (await prepare(await login(ownerEmail), target.chapterId)).statusCode,
    ).toBe(409);
  });

  it("CHR4-HTTP-04/05 complete returns 202 and enqueues processing once", async () => {
    const target = await fixture();
    const cookie = await login(ownerEmail);
    const first = await uploadAndComplete(cookie, target.chapterId);
    expect(first.completed.statusCode).toBe(202);
    expect(first.completed.json()).toMatchObject({ status: "uploaded" });
    const second = await app.inject({
      method: "POST",
      url: `/chapters/${target.chapterId}/replacements/${first.replacementId}/complete`,
      headers: { cookie },
    });
    expect(second.statusCode).toBe(202);
    expect(
      await database.db
        .select()
        .from(chapterReplacementProcessingOutbox)
        .where(
          eq(
            chapterReplacementProcessingOutbox.replacementId,
            first.replacementId,
          ),
        ),
    ).toHaveLength(1);
  });

  it("CHR4-HTTP-07/08 status returns safe lifecycle without storage internals", async () => {
    const target = await fixture();
    const cookie = await login(ownerEmail);
    const prepared = await uploadAndComplete(cookie, target.chapterId);
    await database.db
      .update(chapterReplacementOperations)
      .set({ status: "processing" })
      .where(eq(chapterReplacementOperations.id, prepared.replacementId));
    const response = await app.inject({
      method: "GET",
      url: `/chapters/${target.chapterId}/replacements/${prepared.replacementId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      replacementId: prepared.replacementId,
      chapterId: target.chapterId,
      status: "processing",
    });
    expect(response.body).not.toContain("StorageKey");
    expect(response.body).not.toContain("Media/");
  });

  it("CHR4-HTTP-09 denies path/replacement mismatch", async () => {
    const source = await fixture();
    const other = await fixture();
    const cookie = await login(ownerEmail);
    const prepared = await uploadAndComplete(cookie, source.chapterId);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/chapters/${other.chapterId}/replacements/${prepared.replacementId}`,
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it("CHR4-HTTP-10/11 ready observation performs server-owned activation", async () => {
    const target = await fixture();
    const cookie = await login(ownerEmail);
    const prepared = await uploadAndComplete(cookie, target.chapterId);
    await makeReady({ ...target, replacementId: prepared.replacementId });
    const response = await app.inject({
      method: "GET",
      url: `/chapters/${target.chapterId}/replacements/${prepared.replacementId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "completed",
      result: { imageCount: 1, retainedImageCount: 1 },
    });
  });

  it("CHR4-HTTP-06/12 completed POST and repeated polling return one immutable cutover", async () => {
    const target = await fixture();
    const cookie = await login(ownerEmail);
    const prepared = await uploadAndComplete(cookie, target.chapterId);
    await makeReady({ ...target, replacementId: prepared.replacementId });
    const url = `/chapters/${target.chapterId}/replacements/${prepared.replacementId}`;
    const first = await app.inject({ method: "GET", url, headers: { cookie } });
    const versionCount = (
      await database.db
        .select()
        .from(imageVersions)
        .where(eq(imageVersions.imageId, target.imageId))
    ).length;
    const second = await app.inject({
      method: "GET",
      url,
      headers: { cookie },
    });
    const completed = await app.inject({
      method: "POST",
      url: `${url}/complete`,
      headers: { cookie },
    });
    expect(second.json()).toEqual(first.json());
    expect(completed.statusCode).toBe(200);
    expect(
      (
        await database.db
          .select()
          .from(imageVersions)
          .where(eq(imageVersions.imageId, target.imageId))
      ).length,
    ).toBe(versionCount);
  });

  it("CHR4-HTTP-13 invalid activation leaves publication unchanged", async () => {
    const target = await fixture();
    const cookie = await login(ownerEmail);
    const prepared = await uploadAndComplete(cookie, target.chapterId);
    await database.db
      .update(chapterReplacementOperations)
      .set({ status: "ready" })
      .where(eq(chapterReplacementOperations.id, prepared.replacementId));
    const before = await database.db
      .select()
      .from(imageVersions)
      .where(eq(imageVersions.imageId, target.imageId));
    const response = await app.inject({
      method: "GET",
      url: `/chapters/${target.chapterId}/replacements/${prepared.replacementId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(500);
    expect(
      await database.db
        .select()
        .from(imageVersions)
        .where(eq(imageVersions.imageId, target.imageId)),
    ).toEqual(before);
  });
});
