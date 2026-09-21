import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { DrizzleChapterDeletionRepository } from "../../apps/worker/src/deletion/infrastructure/persistence/drizzle/chapter-deletion.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapterDeletionOutbox,
  chapters,
  series,
  seriesAssignments,
  users,
} from "../../database/schema/index.js";
import {
  FakeDiscordSeriesChannelGateway,
  withM2DSeriesFixtures,
} from "./helpers/discord-series-channel-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = withM2DSeriesFixtures(
  buildApp(
    { logger: false },
    {
      database: database.db,
      secureCookie: false,
      seriesChannelGateway: new FakeDiscordSeriesChannelGateway(),
    },
  ),
);
const password = "m3-test-password";
const ownerId = randomUUID();
const otherId = randomUUID();
const helperId = randomUUID();
const adminId = randomUUID();
const gestorId = randomUUID();
const uploaderTwoId = randomUUID();
const pendingUploaderId = randomUUID();
const suspendedUploaderId = randomUUID();
const emails = {
  owner: `m3-owner-${ownerId}@example.com`,
  other: `m3-other-${otherId}@example.com`,
  helper: `m3-helper-${helperId}@example.com`,
  admin: `m3-admin-${adminId}@example.com`,
  gestor: `m3-gestor-${gestorId}@example.com`,
  uploaderTwo: `m3-uploader-two-${uploaderTwoId}@example.com`,
  pendingUploader: `m3-pending-uploader-${pendingUploaderId}@example.com`,
  suspendedUploader: `m3-suspended-uploader-${suspendedUploaderId}@example.com`,
};
const hasher = new Argon2PasswordHasher();

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
      id: ownerId,
      email: emails.owner,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: otherId,
      email: emails.other,
      passwordHash,
      status: "active",
      role: "gestor",
    },
    {
      id: helperId,
      email: emails.helper,
      passwordHash,
      status: "active",
      role: "uploader",
    },
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
      id: uploaderTwoId,
      email: emails.uploaderTwo,
      passwordHash,
      status: "active",
      role: "uploader",
    },
    {
      id: pendingUploaderId,
      email: emails.pendingUploader,
      passwordHash,
      status: "pending",
      role: "uploader",
    },
    {
      id: suspendedUploaderId,
      email: emails.suspendedUploader,
      passwordHash,
      status: "suspended",
      role: "uploader",
    },
  ]);
});

afterAll(async () => {
  await database.db
    .delete(seriesAssignments)
    .where(
      inArray(seriesAssignments.assignedBy, [
        ownerId,
        otherId,
        helperId,
        adminId,
        gestorId,
      ]),
    );
  await database.db
    .delete(chapterDeletionOutbox)
    .where(
      inArray(chapterDeletionOutbox.requestedBy, [
        ownerId,
        otherId,
        helperId,
        adminId,
        gestorId,
      ]),
    );
  await database.db
    .delete(auditLogs)
    .where(
      inArray(auditLogs.actorId, [
        ownerId,
        otherId,
        helperId,
        adminId,
        gestorId,
      ]),
    );
  await database.db
    .delete(chapters)
    .where(
      inArray(chapters.createdBy, [
        ownerId,
        otherId,
        helperId,
        adminId,
        gestorId,
      ]),
    );
  await database.db
    .delete(series)
    .where(
      inArray(series.createdBy, [
        ownerId,
        otherId,
        helperId,
        adminId,
        gestorId,
      ]),
    );
  await database.db
    .delete(users)
    .where(
      inArray(users.id, [
        ownerId,
        otherId,
        helperId,
        adminId,
        gestorId,
        uploaderTwoId,
        pendingUploaderId,
        suspendedUploaderId,
      ]),
    );
  await app.close();
  await database.sql.end();
});

describe("M3 Series and Chapters Core", () => {
  it("keeps public identities stable when editable labels or numbers change", async () => {
    const ownerCookie = await login(emails.owner);
    const slug = "stable-media";
    const createdSeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Stable Media", slug },
    });
    expect(createdSeries.statusCode).toBe(201);
    const seriesId = createdSeries.json().id as string;
    const emptySeriesCapabilities = await app.inject({
      method: "GET",
      url: `/series/${seriesId}/capabilities`,
      headers: { cookie: ownerCookie },
    });
    expect(emptySeriesCapabilities.statusCode).toBe(200);
    expect(emptySeriesCapabilities.json().capabilities).toContain(
      "images.upload",
    );
    const createdChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
      payload: { chapterNumber: 6 },
    });
    expect(createdChapter.statusCode).toBe(201);
    const chapterId = createdChapter.json().id as string;

    const seriesCapabilities = await app.inject({
      method: "GET",
      url: `/series/${seriesId}/capabilities`,
      headers: { cookie: ownerCookie },
    });
    expect(seriesCapabilities.statusCode).toBe(200);
    expect(seriesCapabilities.json().capabilities).toEqual(
      expect.arrayContaining([
        "series.read",
        "series.edit",
        "series.delete",
        "chapters.create",
        "images.upload",
        "series.assignment.manage",
      ]),
    );

    const chapterCapabilities = await app.inject({
      method: "GET",
      url: `/chapters/${chapterId}/capabilities`,
      headers: { cookie: ownerCookie },
    });
    expect(chapterCapabilities.statusCode).toBe(200);
    expect(chapterCapabilities.json().capabilities).toEqual(
      expect.arrayContaining([
        "chapters.read",
        "chapters.edit",
        "chapters.delete",
        "images.upload",
      ]),
    );

    const renamed = await app.inject({
      method: "PATCH",
      url: `/series/${seriesId}`,
      headers: { cookie: ownerCookie },
      payload: { title: "Renamed Stable Media" },
    });
    expect(renamed.statusCode).toBe(200);
    const [storedSeries] = await database.db
      .select({ slug: series.slug })
      .from(series)
      .where(eq(series.id, seriesId));
    expect(storedSeries?.slug).toBe(slug);

    await database.db
      .update(chapters)
      .set({ chapterNumber: 7 })
      .where(eq(chapters.id, chapterId));
    const [storedChapter] = await database.db
      .select({ number: chapters.chapterNumber, publicKey: chapters.publicKey })
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    expect(storedChapter).toEqual({ number: 7, publicKey: "6" });
  });

  it("persists external cover URLs and manages the responsible user without changing ownership", async () => {
    const ownerCookie = await login(emails.owner);
    const otherCookie = await login(emails.other);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: {
        title: "Covered Series",
        slug: `covered-${ownerId}`,
        coverUrl: "https://i.imgur.com/cover.jpg",
      },
    });
    expect(created.statusCode).toBe(201);
    const seriesId = created.json().id as string;
    expect(created.json().coverUrl).toBe("https://i.imgur.com/cover.jpg");

    const candidates = await app.inject({
      method: "GET",
      url: `/series/${seriesId}/responsible-candidates`,
      headers: { cookie: ownerCookie },
    });
    expect(candidates.statusCode).toBe(200);
    const candidateIds = candidates
      .json()
      .map((item: { id: string }) => item.id);
    expect(candidateIds).toContain(helperId);
    expect(candidateIds).toContain(uploaderTwoId);
    expect(candidateIds).not.toContain(pendingUploaderId);
    expect(candidateIds).not.toContain(suspendedUploaderId);

    const unauthorized = await app.inject({
      method: "GET",
      url: `/series/${seriesId}/responsible-candidates`,
      headers: { cookie: otherCookie },
    });
    expect(unauthorized.statusCode).toBe(403);

    const assign = await app.inject({
      method: "PUT",
      url: `/series/${seriesId}/responsible`,
      headers: { cookie: ownerCookie },
      payload: { responsibleUserId: helperId },
    });
    expect(assign.statusCode).toBe(200);
    const reassign = await app.inject({
      method: "PUT",
      url: `/series/${seriesId}/responsible`,
      headers: { cookie: ownerCookie },
      payload: { responsibleUserId: uploaderTwoId },
    });
    expect(reassign.statusCode).toBe(200);
    const assignedRead = await app.inject({
      method: "GET",
      url: `/series/${seriesId}`,
      headers: { cookie: ownerCookie },
    });
    expect(assignedRead.json().responsibleUser).toEqual({
      id: uploaderTwoId,
      email: emails.uploaderTwo,
      role: "uploader",
    });

    const returnToOwner = await app.inject({
      method: "PUT",
      url: `/series/${seriesId}/responsible`,
      headers: { cookie: ownerCookie },
      payload: { responsibleUserId: ownerId },
    });
    expect(returnToOwner.statusCode).toBe(200);
    const updated = await app.inject({
      method: "PATCH",
      url: `/series/${seriesId}`,
      headers: { cookie: ownerCookie },
      payload: { coverUrl: null, title: "Covered Series Updated" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().coverUrl).toBeNull();
    expect(updated.json().slug).toBe("covered-series");
    const [stored] = await database.db
      .select({ createdBy: series.createdBy })
      .from(series)
      .where(eq(series.id, seriesId));
    expect(stored?.createdBy).toBe(ownerId);
  });

  it("owns canonical Series slugs and maps collisions without leaking SQL", async () => {
    const ownerCookie = await login(emails.owner);
    const suffix = randomUUID();
    const title = `Café / Stable ${suffix}`;
    const expectedSlug = `cafe-stable-${suffix}`;

    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title, slug: `client-override-${suffix}` },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().slug).toBe(expectedSlug);
    const seriesId = created.json().id as string;

    const renamed = await app.inject({
      method: "PATCH",
      url: `/series/${seriesId}`,
      headers: { cookie: ownerCookie },
      payload: { title: `Renamed ${suffix}`, description: "Updated" },
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json().slug).toBe(expectedSlug);

    const descriptionOnly = await app.inject({
      method: "PATCH",
      url: `/series/${seriesId}`,
      headers: { cookie: ownerCookie },
      payload: { description: "Description-only update" },
    });
    expect(descriptionOnly.statusCode).toBe(200);
    expect(descriptionOnly.json().slug).toBe(expectedSlug);

    const duplicate = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({
      code: "series-slug-conflict",
      category: "conflict",
      requestId: expect.any(String),
    });
    expect(JSON.stringify(duplicate.json())).not.toContain(
      "series_slug_unique",
    );

    const concurrentTitle = `Concurrent ${randomUUID()}`;
    const concurrent = await Promise.all([
      app.inject({
        method: "POST",
        url: "/series",
        headers: { cookie: ownerCookie },
        payload: { title: concurrentTitle },
      }),
      app.inject({
        method: "POST",
        url: "/series",
        headers: { cookie: ownerCookie },
        payload: { title: concurrentTitle },
      }),
    ]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    expect(
      concurrent.find((response) => response.statusCode === 409)?.json(),
    ).toMatchObject({
      code: "series-slug-conflict",
      requestId: expect.any(String),
    });

    const emptyCanonical = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "日本語" },
    });
    expect(emptyCanonical.statusCode).toBe(422);
    expect(emptyCanonical.json()).toMatchObject({
      code: "series-slug-invalid",
    });
  });

  it("implements the authenticated Series and Chapter CRUD contract", async () => {
    const ownerCookie = await login(emails.owner);
    const createdSeries = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Series One", slug: `series-${ownerId}` },
    });
    expect(createdSeries.statusCode).toBe(201);
    const seriesId = createdSeries.json().id as string;

    expect(
      (
        await app.inject({
          method: "GET",
          url: "/series",
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/series/${seriesId}`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/series/${seriesId}`,
          headers: { cookie: ownerCookie },
          payload: { title: "Updated" },
        })
      ).statusCode,
    ).toBe(200);

    const createdChapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
      payload: { chapterNumber: 1, title: "Chapter One" },
    });
    expect(createdChapter.statusCode).toBe(201);
    const chapterId = createdChapter.json().id as string;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/series/${seriesId}/chapters`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/chapters/${chapterId}`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/chapters/${chapterId}`,
          headers: { cookie: ownerCookie },
          payload: { title: "Updated Chapter" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/series/${seriesId}/chapters`,
          headers: { cookie: ownerCookie },
          payload: { chapterNumber: 1 },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/series/${seriesId}`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${chapterId}`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(204);
    const [deletion] = await database.db
      .select({ id: chapterDeletionOutbox.id })
      .from(chapterDeletionOutbox)
      .where(eq(chapterDeletionOutbox.chapterId, chapterId));
    if (!deletion) throw new Error("expected-chapter-deletion-request");
    await new DrizzleChapterDeletionRepository(database.db).finalize(
      deletion.id,
      chapterId,
    );
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/series/${seriesId}`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(204);
  });

  it("accepts exact non-negative decimal Chapter numbers and orders them numerically", async () => {
    const ownerCookie = await login(emails.owner);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Decimal Chapters", slug: `decimal-${randomUUID()}` },
    });
    expect(created.statusCode).toBe(201);
    const seriesId = created.json().id as string;
    const values = [0, 0.1, 0.5, 1, 1.5, 2.1, 25.125];
    for (const chapterNumber of values) {
      const response = await app.inject({
        method: "POST",
        url: `/series/${seriesId}/chapters`,
        headers: { cookie: ownerCookie },
        payload: { chapterNumber },
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json().chapterNumber).toBe(chapterNumber);
      if (chapterNumber === 0) expect(response.json().status).toBe("draft");
    }
    const listed = await app.inject({
      method: "GET",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
    });
    expect(listed.statusCode).toBe(200);
    expect(
      listed
        .json()
        .map((chapter: { chapterNumber: number }) => chapter.chapterNumber),
    ).toEqual(values);

    for (const chapterNumber of [-0.1, -1, 1.2345]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: `/series/${seriesId}/chapters`,
            headers: { cookie: ownerCookie },
            payload: { chapterNumber },
          })
        ).statusCode,
      ).toBe(422);
    }
    const duplicate = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
      payload: { chapterNumber: 1.5 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ code: "chapter-conflict" });

    const edited = await app.inject({
      method: "PATCH",
      url: `/chapters/${
        listed
          .json()
          .find(
            (chapter: { chapterNumber: number }) =>
              chapter.chapterNumber === 1.5,
          ).id as string
      }`,
      headers: { cookie: ownerCookie },
      payload: { title: "Decimal title" },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().chapterNumber).toBe(1.5);
  });

  it("maps concurrent canonical-equivalent Chapter creates to one conflict", async () => {
    const ownerCookie = await login(emails.owner);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: {
        title: "Concurrent Decimal Chapters",
        slug: `decimal-concurrent-${randomUUID()}`,
      },
    });
    expect(created.statusCode).toBe(201);
    const seriesId = created.json().id as string;
    const responses = await Promise.all(
      [1.5, 1.5].map((chapterNumber) =>
        app.inject({
          method: "POST",
          url: `/series/${seriesId}/chapters`,
          headers: { cookie: ownerCookie },
          payload: { chapterNumber },
        }),
      ),
    );
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      201, 409,
    ]);
    expect(
      responses.find((response) => response.statusCode === 409)?.json(),
    ).toMatchObject({ code: "chapter-conflict" });
  });

  it("keeps Series administration owned while allowing Gestor Chapter support", async () => {
    const ownerCookie = await login(emails.owner);
    const otherCookie = await login(emails.other);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Protected", slug: `protected-${ownerId}` },
    });
    const seriesId = created.json().id as string;
    const chapter = await app.inject({
      method: "POST",
      url: `/series/${seriesId}/chapters`,
      headers: { cookie: ownerCookie },
      payload: { chapterNumber: 1 },
    });
    const chapterId = chapter.json().id as string;

    expect(
      (
        await app.inject({
          method: "GET",
          url: `/series/${seriesId}`,
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/series/${seriesId}`,
          headers: { cookie: otherCookie },
          payload: { title: "attack" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/series/${seriesId}`,
          headers: { cookie: otherCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/series/${seriesId}/chapters`,
          headers: { cookie: otherCookie },
          payload: { chapterNumber: 2 },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/chapters/${chapterId}`,
          headers: { cookie: otherCookie },
          payload: { title: "Supported without Series ownership" },
        })
      ).statusCode,
    ).toBe(200);

    const forged = await app.inject({
      method: "PATCH",
      url: `/chapters/${chapterId}`,
      headers: { cookie: ownerCookie },
      payload: {
        title: "attack",
        ownerId: otherId,
        createdBy: otherId,
        role: "admin",
        permission: "chapters.delete",
        capability: "chapters.delete",
        isOwner: true,
        canEdit: true,
      },
    });
    expect(forged.statusCode).toBe(422);
  });

  it("keeps Chapter delete non-delegable while allowing Gestor support", async () => {
    const ownerCookie = await login(emails.owner);
    const helperCookie = await login(emails.helper);
    const adminCookie = await login(emails.admin);
    const gestorCookie = await login(emails.gestor);
    const created = await app.inject({
      method: "POST",
      url: "/series",
      headers: { cookie: ownerCookie },
      payload: { title: "Delete Policy", slug: `delete-policy-${ownerId}` },
    });
    const seriesId = created.json().id as string;
    const createChapter = async (number: number) =>
      (
        await app.inject({
          method: "POST",
          url: `/series/${seriesId}/chapters`,
          headers: { cookie: ownerCookie },
          payload: { chapterNumber: number },
        })
      ).json().id as string;
    const helperChapter = await createChapter(1);
    const readOnlyChapter = await createChapter(2);
    const adminChapter = await createChapter(3);
    const gestorChapter = await createChapter(4);
    const ownerDeleteChapter = await createChapter(5);

    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${helperChapter}/permissions`,
          headers: { cookie: ownerCookie },
          payload: { userId: helperId, permissions: ["chapters.edit"] },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/chapters/${readOnlyChapter}/permissions`,
          headers: { cookie: ownerCookie },
          payload: { userId: helperId, permissions: ["chapters.read"] },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${helperChapter}`,
          headers: { cookie: helperCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${readOnlyChapter}`,
          headers: { cookie: helperCookie },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${adminChapter}`,
          headers: { cookie: adminCookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${gestorChapter}`,
          headers: { cookie: gestorCookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${ownerDeleteChapter}`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(204);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/chapters/${randomUUID()}`,
          headers: { cookie: ownerCookie },
        })
      ).statusCode,
    ).toBe(404);
  });
});
