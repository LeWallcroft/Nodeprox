import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterReplacementOperations,
  chapters,
  domainEventOutbox,
  imageReplacementOperations,
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
  readonly verified: string[] = [];
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
      url: "https://uploads.example.test/direct-put?signature=temporary",
      headers: { "content-type": input.contentType },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }

  async verify(input: { key: string }): Promise<VerifiedUploadedObject> {
    this.verified.push(input.key);
    const object = this.objects.get(input.key);
    if (!object) throw new UploadTransferObjectNotFoundError();
    return object;
  }

  async abort(input: { key: string }): Promise<void> {
    this.objects.delete(input.key);
  }
}

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const transfer = new ReplacementTransfer();
const app = buildApp(
  { logger: false },
  {
    database: database.db,
    secureCookie: false,
    storage: { provider: "filesystem", uploadMaxSizeBytes: 100 },
    uploadTransfer: transfer,
  },
);
const ownerId = randomUUID();
const otherId = randomUUID();
const seriesId = randomUUID();
const chapterId = randomUUID();
const imageId = randomUUID();
const password = "replacement-completion-password";
const ownerEmail = `replacement-completion-owner-${ownerId}@example.com`;
const otherEmail = `replacement-completion-other-${otherId}@example.com`;
const hasher = new Argon2PasswordHasher();

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

async function prepare(cookie: string): Promise<{ replacementId: string }> {
  const response = await app.inject({
    method: "POST",
    url: `/chapters/${chapterId}/images/${imageId}/replacement-session`,
    headers: { cookie },
    payload: {
      filename: "replacement.jpg",
      contentType: "image/jpeg",
      sizeBytes: 10,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

async function complete(
  cookie: string | undefined,
  replacementId: string,
  input?: {
    chapterId?: string;
    imageId?: string;
    payload?: Record<string, unknown>;
  },
) {
  return app.inject({
    method: "POST",
    url: `/chapters/${input?.chapterId ?? chapterId}/images/${input?.imageId ?? imageId}/replacements/${replacementId}/complete`,
    ...(cookie ? { headers: { cookie } } : {}),
    ...(input?.payload ? { payload: input.payload } : {}),
  });
}

async function uploadedReplacement(cookie: string) {
  const prepared = await prepare(cookie);
  const initiated = transfer.initiated.at(-1);
  if (!initiated) throw new Error("Expected replacement upload grant");
  transfer.objects.set(initiated.key, {
    key: initiated.key,
    contentType: initiated.contentType,
    sizeBytes: initiated.sizeBytes,
    etag: `etag-${prepared.replacementId}`,
  });
  return prepared;
}

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
      id: otherId,
      email: otherEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
  await database.db.insert(series).values({
    id: seriesId,
    title: "Replacement Completion Series",
    slug: `replacement-completion-${seriesId}`,
    createdBy: ownerId,
  });
  await database.db.insert(chapters).values({
    id: chapterId,
    seriesId,
    chapterNumber: 1,
    publicKey: "1",
    createdBy: ownerId,
    status: "ready",
  });
  await insertImagesWithInitialVersions(database.db, [
    {
      id: imageId,
      chapterId,
      filename: "01.jpg",
      storageKey: `Media/replacement-completion-${seriesId}/1/01.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 10,
      sortOrder: 1,
      checksum: "replacement-completion-image",
    },
  ]);
});

afterAll(async () => {
  const replacementIds = await database.db
    .select({ id: imageReplacementOperations.id })
    .from(imageReplacementOperations)
    .where(eq(imageReplacementOperations.imageId, imageId));
  if (replacementIds.length > 0)
    await database.db.delete(domainEventOutbox).where(
      inArray(
        domainEventOutbox.aggregateId,
        replacementIds.map(({ id }) => id),
      ),
    );
  await database.db
    .delete(mediaEffectOutbox)
    .where(eq(mediaEffectOutbox.imageId, imageId));
  await database.db
    .delete(auditLogs)
    .where(
      and(
        eq(auditLogs.resourceType, "image"),
        eq(auditLogs.resourceId, imageId),
      ),
    );
  await database.db
    .delete(imageReplacementOperations)
    .where(eq(imageReplacementOperations.imageId, imageId));
  await database.db
    .delete(chapterReplacementOperations)
    .where(eq(chapterReplacementOperations.chapterId, chapterId));
  await database.db.delete(images).where(eq(images.id, imageId));
  await database.db.delete(chapters).where(eq(chapters.id, chapterId));
  await database.db.delete(series).where(eq(series.id, seriesId));
  await database.db.delete(users).where(inArray(users.id, [ownerId, otherId]));
  await app.close();
  await database.sql.end();
});

afterEach(async () => {
  const replacementIds = await database.db
    .select({ id: imageReplacementOperations.id })
    .from(imageReplacementOperations)
    .where(eq(imageReplacementOperations.imageId, imageId));
  if (replacementIds.length > 0)
    await database.db.delete(domainEventOutbox).where(
      inArray(
        domainEventOutbox.aggregateId,
        replacementIds.map(({ id }) => id),
      ),
    );
  await database.db
    .delete(imageReplacementOperations)
    .where(eq(imageReplacementOperations.imageId, imageId));
  await database.db
    .delete(chapterReplacementOperations)
    .where(eq(chapterReplacementOperations.chapterId, chapterId));
  transfer.initiated.splice(0);
  transfer.verified.splice(0);
  transfer.objects.clear();
});

describe("image replacement completion HTTP contract", () => {
  it("accepts an uploaded replacement for durable background completion", async () => {
    const prepared = await uploadedReplacement(await login(ownerEmail));
    const response = await complete(
      await login(ownerEmail),
      prepared.replacementId,
    );

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      replacementId: prepared.replacementId,
      imageId,
      chapterId,
      status: "uploaded",
    });
    expect(response.json()).not.toHaveProperty("storageKey");
    expect(response.json()).not.toHaveProperty("candidateStorageKey");
    expect(transfer.verified).toEqual([transfer.initiated.at(-1)?.key]);
    expect(
      await database.db
        .select()
        .from(domainEventOutbox)
        .where(eq(domainEventOutbox.aggregateId, prepared.replacementId)),
    ).toEqual([
      expect.objectContaining({
        eventType: "image.replacement.ready",
        aggregateType: "image_replacement",
      }),
    ]);
  });

  it("returns the same queued result without a duplicate durable event", async () => {
    const cookie = await login(ownerEmail);
    const prepared = await uploadedReplacement(cookie);
    const first = await complete(cookie, prepared.replacementId);
    const verifiedBeforeRetry = transfer.verified.length;
    const versionsBeforeRetry = await database.db
      .select({ id: imageVersions.id })
      .from(imageVersions)
      .where(eq(imageVersions.imageId, imageId));
    const eventsBeforeRetry = await database.db
      .select()
      .from(domainEventOutbox)
      .where(eq(domainEventOutbox.aggregateId, prepared.replacementId));

    const second = await complete(cookie, prepared.replacementId);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json()).toEqual(first.json());
    expect(transfer.verified).toHaveLength(verifiedBeforeRetry);
    const versionsAfterRetry = await database.db
      .select({ id: imageVersions.id })
      .from(imageVersions)
      .where(eq(imageVersions.imageId, imageId));
    expect(versionsAfterRetry).toHaveLength(versionsBeforeRetry.length);
    expect(
      await database.db
        .select()
        .from(domainEventOutbox)
        .where(eq(domainEventOutbox.aggregateId, prepared.replacementId)),
    ).toHaveLength(eventsBeforeRetry.length);
  });

  it("requires authentication and replacement authorization", async () => {
    const prepared = await prepare(await login(ownerEmail));
    expect((await complete(undefined, prepared.replacementId)).statusCode).toBe(
      401,
    );
    expect(
      (await complete(await login(otherEmail), prepared.replacementId))
        .statusCode,
    ).toBe(403);
  });

  it("does not allow a full Chapter replacement while an image replacement is active", async () => {
    const cookie = await login(ownerEmail);
    await prepare(cookie);

    const response = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/replacement-session`,
      headers: { cookie },
      payload: {
        filename: "chapter.zip",
        contentType: "application/zip",
        sizeBytes: 10,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: "chapter-replacement-conflict",
    });
  });

  it("does not allow an image replacement while a full Chapter replacement is active", async () => {
    const cookie = await login(ownerEmail);
    const chapterReplacement = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/replacement-session`,
      headers: { cookie },
      payload: {
        filename: "chapter.zip",
        contentType: "application/zip",
        sizeBytes: 10,
      },
    });
    expect(chapterReplacement.statusCode).toBe(201);

    const imageReplacement = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/images/${imageId}/replacement-session`,
      headers: { cookie },
      payload: {
        filename: "replacement.jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
      },
    });

    expect(imageReplacement.statusCode).toBe(409);
    expect(imageReplacement.json()).toMatchObject({
      code: "image-replacement-conflict",
    });
  });

  it("rejects malformed input, wrong scope, client storage fields, and missing candidates safely", async () => {
    const cookie = await login(ownerEmail);
    const prepared = await prepare(cookie);
    for (const url of [
      `/chapters/not-a-uuid/images/${imageId}/replacements/${prepared.replacementId}/complete`,
      `/chapters/${chapterId}/images/not-a-uuid/replacements/${prepared.replacementId}/complete`,
      `/chapters/${chapterId}/images/${imageId}/replacements/not-a-uuid/complete`,
    ]) {
      expect(
        (await app.inject({ method: "POST", url, headers: { cookie } }))
          .statusCode,
      ).toBe(400);
    }
    expect(
      (
        await complete(cookie, prepared.replacementId, {
          chapterId: randomUUID(),
        })
      ).statusCode,
    ).toBe(404);
    for (const field of [
      "storageKey",
      "candidateStorageKey",
      "version",
      "resultImageVersionId",
      "userId",
      "role",
    ]) {
      expect(
        (
          await complete(cookie, prepared.replacementId, {
            payload: { [field]: "client-controlled" },
          })
        ).statusCode,
      ).toBe(400);
    }
    const missing = await complete(cookie, prepared.replacementId);
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      code: "image-replacement-not-found",
    });
    expect(missing.body).not.toContain("Media/");
  });

  it("returns the stable accepted projection while background completion owns the operation", async () => {
    const cookie = await login(ownerEmail);
    const prepared = await prepare(cookie);
    await database.db
      .update(imageReplacementOperations)
      .set({ status: "completing", updatedAt: new Date() })
      .where(eq(imageReplacementOperations.id, prepared.replacementId));

    const response = await complete(cookie, prepared.replacementId);
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      replacementId: prepared.replacementId,
      status: "completing",
    });
  });
});
