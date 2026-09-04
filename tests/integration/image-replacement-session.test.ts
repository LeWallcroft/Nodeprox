import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  chapters,
  imageReplacementOperations,
  images,
  series,
  users,
} from "../../database/schema/index.js";
import type {
  UploadTransferPort,
  VerifiedUploadedObject,
} from "../../packages/storage/dist/port.js";
import { insertImagesWithInitialVersions } from "./helpers/image-fixture.js";

class ReplacementSessionTransfer implements UploadTransferPort {
  readonly initiated: Array<{
    key: string;
    contentType: string;
    sizeBytes: number;
  }> = [];
  readonly verified: string[] = [];

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
    throw new Error("Verify is not part of replacement-session preparation");
  }

  async abort(): Promise<void> {}
}

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const transfer = new ReplacementSessionTransfer();
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
const password = "replacement-session-password";
const ownerEmail = `replacement-owner-${ownerId}@example.com`;
const otherEmail = `replacement-other-${otherId}@example.com`;
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

async function prepare(
  cookie: string | undefined,
  payload: Record<string, unknown> = {
    filename: "replacement.jpg",
    contentType: "image/jpeg",
    sizeBytes: 10,
  },
  target: { chapterId: string; imageId: string } = { chapterId, imageId },
) {
  return app.inject({
    method: "POST",
    url: `/chapters/${target.chapterId}/images/${target.imageId}/replacement-session`,
    ...(cookie ? { headers: { cookie } } : {}),
    payload,
  });
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
    title: "Replacement Session Series",
    slug: `replacement-session-${seriesId}`,
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
      storageKey: `Media/replacement-session-${seriesId}/1/01.jpg`,
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 10,
      sortOrder: 1,
      checksum: "replacement-session-image",
    },
  ]);
});

afterAll(async () => {
  await database.db
    .delete(imageReplacementOperations)
    .where(eq(imageReplacementOperations.imageId, imageId));
  await database.db.delete(images).where(eq(images.id, imageId));
  await database.db.delete(chapters).where(eq(chapters.id, chapterId));
  await database.db.delete(series).where(eq(series.id, seriesId));
  await database.db.delete(users).where(inArray(users.id, [ownerId, otherId]));
  await app.close();
  await database.sql.end();
});

describe("image replacement-session HTTP contract", () => {
  it("creates a durable replacement and returns a direct PUT session", async () => {
    const response = await prepare(await login(ownerEmail));

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toEqual({
      replacementId: expect.any(String),
      imageId,
      upload: {
        mode: "single",
        method: "PUT",
        url: "https://uploads.example.test/direct-put?signature=temporary",
        headers: { "content-type": "image/jpeg" },
        expiresAt: expect.any(String),
      },
    });
    expect(body).not.toHaveProperty("candidateStorageKey");
    expect(body).not.toHaveProperty("storageKey");
    expect(transfer.initiated.at(-1)).toMatchObject({
      key: expect.stringContaining("Media/replacement-session-"),
      contentType: "image/jpeg",
      sizeBytes: 10,
    });
    expect(transfer.verified).toEqual([]);
    const [operation] = await database.db
      .select()
      .from(imageReplacementOperations)
      .where(eq(imageReplacementOperations.id, body.replacementId));
    expect(operation).toMatchObject({
      imageId,
      status: "pending_upload",
      resultImageVersionId: null,
    });
  });

  it("requires an authenticated and authorized actor", async () => {
    expect((await prepare(undefined)).statusCode).toBe(401);
    expect((await prepare(await login(otherEmail))).statusCode).toBe(403);
  });

  it("maps invalid media metadata and wrong scope without granting upload", async () => {
    const cookie = await login(ownerEmail);
    const invalidPayloads = [
      {
        filename: "replacement.zip",
        contentType: "application/zip",
        sizeBytes: 10,
      },
      {
        filename: "replacement.avif",
        contentType: "image/avif",
        sizeBytes: 10,
      },
      {
        filename: "replacement.jpg",
        contentType: "image/jpeg",
        sizeBytes: 101,
      },
      {
        filename: "replacement.jpg",
        contentType: "image/jpeg",
        sizeBytes: 0,
      },
    ];
    const before = transfer.initiated.length;
    for (const payload of invalidPayloads) {
      const response = await prepare(cookie, payload);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        code: "image-replacement-invalid",
      });
    }
    expect(transfer.initiated).toHaveLength(before);

    const scope = await prepare(cookie, undefined, {
      chapterId: randomUUID(),
      imageId,
    });
    expect(scope.statusCode).toBe(404);
  });

  it("rejects client-controlled authority fields and does not relay binary", async () => {
    const cookie = await login(ownerEmail);
    for (const field of [
      "storageKey",
      "candidateStorageKey",
      "replacementId",
      "version",
      "userId",
      "role",
      "resultImageVersionId",
    ]) {
      const response = await prepare(cookie, {
        filename: "replacement.jpg",
        contentType: "image/jpeg",
        sizeBytes: 10,
        [field]: "client-controlled",
      });
      expect(response.statusCode).toBe(422);
    }

    const before = transfer.initiated.length;
    const response = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/images/${imageId}/replacement-session`,
      headers: {
        cookie,
        "content-type": "application/octet-stream",
      },
      payload: Buffer.from("binary-image-body"),
    });
    expect(response.statusCode).not.toBe(201);
    expect(transfer.initiated).toHaveLength(before);
    expect(transfer.verified).toEqual([]);
  });
});
