import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { transitionChapterState } from "../../database/chapter-state-transition.js";
import { createDatabase } from "../../database/client.js";
import { chapters, series, users } from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const userId = randomUUID();
const seriesId = randomUUID();
const chapterIds: string[] = [];

async function createChapter(
  status: typeof chapters.$inferInsert.status = "draft",
) {
  const id = randomUUID();
  chapterIds.push(id);
  await database.db.insert(chapters).values({
    id,
    seriesId,
    chapterNumber: chapterIds.length,
    publicKey: String(chapterIds.length),
    status,
    createdBy: userId,
  });
  return id;
}

beforeAll(async () => {
  await database.db.insert(users).values({
    id: userId,
    email: `chapter-state-${userId}@example.com`,
    passwordHash: "not-used",
    status: "active",
    role: "admin",
  });
  await database.db.insert(series).values({
    id: seriesId,
    title: "Chapter State",
    slug: `chapter-state-${seriesId}`,
    createdBy: userId,
  });
});

afterAll(async () => {
  await database.db.delete(chapters).where(eq(chapters.seriesId, seriesId));
  await database.db.delete(series).where(eq(series.id, seriesId));
  await database.db.delete(users).where(eq(users.id, userId));
  await database.sql.end();
});

describe("atomic Chapter state transitions", () => {
  it("persists a valid compare-and-transition", async () => {
    const chapterId = await createChapter();
    const result = await database.db.transaction((tx) =>
      transitionChapterState(tx, {
        chapterId,
        transition: "start-upload",
        expectedStates: ["draft"],
      }),
    );
    expect(result).toEqual({
      transitioned: true,
      previousState: "draft",
      currentState: "uploading",
    });
  });

  it("rejects stale expected state without overwriting the current state", async () => {
    const chapterId = await createChapter("uploading");
    const result = await database.db.transaction((tx) =>
      transitionChapterState(tx, {
        chapterId,
        transition: "abort-upload",
        expectedStates: ["draft"],
      }),
    );
    expect(result).toEqual({
      transitioned: false,
      reason: "concurrent-state-change",
      currentState: "uploading",
    });
  });

  it("serializes concurrent transitions so only one stale claimant wins", async () => {
    const chapterId = await createChapter();
    const run = () =>
      database.db.transaction((tx) =>
        transitionChapterState(tx, {
          chapterId,
          transition: "start-upload",
          expectedStates: ["draft"],
        }),
      );
    const results = await Promise.all([run(), run()]);
    expect(results.filter((result) => result.transitioned)).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          !result.transitioned && result.reason === "concurrent-state-change",
      ),
    ).toHaveLength(1);
  });

  it("denies processing to deleting without persistence", async () => {
    const chapterId = await createChapter("processing");
    const result = await database.db.transaction((tx) =>
      transitionChapterState(tx, {
        chapterId,
        transition: "request-deletion",
      }),
    );
    expect(result).toEqual({
      transitioned: false,
      reason: "invalid-transition",
      currentState: "processing",
    });
    const [chapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, chapterId));
    expect(chapter?.status).toBe("processing");
  });
});
