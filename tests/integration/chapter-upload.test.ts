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

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
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

describe("M4-A chapter upload", () => {
  it("requires authentication and stores one ZIP with server-side metadata", async () => {
    const unauthenticated = await app.inject({
      method: "POST",
      url: `/chapters/${randomUUID()}/upload`,
    });
    expect(unauthenticated.statusCode).toBe(401);

    const cookie = await login();
    const createdSeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie },
      payload: { title: "Upload Series", slug: `upload-${userId}` },
    });
    const seriesId = createdSeries.json().id as string;
    const createdChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie },
      payload: { chapterNumber: 1 },
    });
    const chapterId = createdChapter.json().id as string;
    const multipart = (contentType: string, bytes: string, fields = "") => {
      const boundary = `upload-${randomUUID()}`;
      const extraField = fields
        ? [
            `--${boundary}`,
            'Content-Disposition: form-data; name="ownerId"',
            "",
            fields,
          ]
        : [];
      const body = [
        ...extraField,
        `--${boundary}`,
        'Content-Disposition: form-data; name="file"; filename="chapter.zip"',
        `Content-Type: ${contentType}`,
        "",
        bytes,
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
    const validUpload = multipart("application/zip", "PK\x03\x04nodeprox");
    const response = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/upload`,
      headers: { cookie, ...validUpload.headers },
      payload: validUpload.body,
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      chapterId,
      status: "uploaded",
      filename: "chapter.zip",
      sizeBytes: Buffer.byteLength("PK\x03\x04nodeprox"),
    });
    const [intent] = await database.db
      .select()
      .from(processingOutbox)
      .where(eq(processingOutbox.chapterId, chapterId));
    expect(intent).toMatchObject({
      chapterId,
      uploadId: response.json().uploadId,
      status: "pending",
    });
    const second = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/upload`,
      headers: { cookie, ...validUpload.headers },
      payload: validUpload.body,
    });
    expect(second.statusCode).toBe(409);

    const forbidden = await app.inject({
      method: "POST",
      url: `/chapters/${chapterId}/upload`,
      headers: { cookie: await login(otherEmail), ...validUpload.headers },
      payload: validUpload.body,
    });
    expect(forbidden.statusCode).toBe(403);

    const mimeChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie },
      payload: { chapterNumber: 2 },
    });
    const mimeUpload = multipart("application/octet-stream", "PK\x03\x04");
    const mimeRejected = await app.inject({
      method: "POST",
      url: `/chapters/${mimeChapter.json().id}/upload`,
      headers: { cookie, ...mimeUpload.headers },
      payload: mimeUpload.body,
    });
    expect(mimeRejected.statusCode).toBe(415);

    const magicChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie },
      payload: { chapterNumber: 3 },
    });
    const magicUpload = multipart("application/zip", "NOPE");
    const magicRejected = await app.inject({
      method: "POST",
      url: `/chapters/${magicChapter.json().id}/upload`,
      headers: { cookie, ...magicUpload.headers },
      payload: magicUpload.body,
    });
    expect(magicRejected.statusCode).toBe(422);

    const forged = multipart(
      "application/zip",
      "PK\x03\x04nodeprox",
      "ownerId=attacker&role=admin&permission=admin.storage.manage&storageKey=../../secrets.zip",
    );
    const forgedRejected = await app.inject({
      method: "POST",
      url: `/chapters/${magicChapter.json().id}/upload`,
      headers: { cookie, ...forged.headers },
      payload: forged.body,
    });
    expect(forgedRejected.statusCode).toBe(201);
    expect(forgedRejected.json().filename).toBe("chapter.zip");
  });
});
