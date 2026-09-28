import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { DrizzleChapterReplacementProcessingWorkerRepository } from "../../apps/worker/src/processing/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import { DrizzleStorageCleanupRepository } from "../../apps/worker/src/storage-cleanup/infrastructure/persistence/drizzle/storage-cleanup.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  chapterReplacementItems,
  chapterReplacementOperations,
  storageCleanupOutbox,
} from "../../database/schema/index.js";
import { createReplacementChapter } from "./helpers/chapter-replacement-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);

afterAll(async () => database.sql.end());

async function target(itemCount = 0, stored = false) {
  const chapter = await createReplacementChapter(database.db, 1);
  const replacementId = randomUUID();
  const sourceStorageKey = `chapter-replacements/${chapter.chapterId}/${replacementId}/source.zip`;
  await database.db.insert(chapterReplacementOperations).values({
    id: replacementId,
    chapterId: chapter.chapterId,
    requestedByUserId: chapter.userId,
    candidateZipStorageKey: sourceStorageKey,
    storageProfileId: "00000000-0000-4000-8000-000000000001",
    originalFilename: "replacement.zip",
    contentType: "application/zip",
    sizeBytes: 100,
    status: "processing",
  });
  const items = Array.from({ length: itemCount }, (_, index) => {
    const id = randomUUID();
    return {
      id,
      operationId: replacementId,
      sortOrder: index + 1,
      candidateStorageKey: `Media/${chapter.seriesSlug}/${chapter.chapterPublicKey}/${id}.png`,
      storageProfileId: "00000000-0000-4000-8000-000000000001",
      physicalFilename: `${id}.png`,
      originalFilename: `${String(index + 1).padStart(2, "0")}.png`,
      contentType: "image/png",
      sizeBytes: 16,
      checksum: `checksum-${index}`,
      ...(stored ? { storedAt: new Date() } : {}),
    };
  });
  if (items.length)
    await database.db.insert(chapterReplacementItems).values(items);
  return { chapter, replacementId, sourceStorageKey, items };
}

const processing = new DrizzleChapterReplacementProcessingWorkerRepository(
  database.db,
);
const cleanup = new DrizzleStorageCleanupRepository(database.db);

describe("CHR3 durable storage cleanup", () => {
  it("CHR3-CLN-01 terminal invalid ZIP schedules source cleanup", async () => {
    const candidate = await target();
    await processing.markFailed(candidate.replacementId, "invalid-zip-path");
    const rows = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.replacementId, candidate.replacementId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      storageKey: candidate.sourceStorageKey,
      reason: "replacement_source_zip",
    });
  });

  it("CHR3-CLN-02 partial failure schedules every planned candidate", async () => {
    const candidate = await target(3, true);
    await processing.markFailed(
      candidate.replacementId,
      "image-magic-mismatch",
    );
    const rows = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.replacementId, candidate.replacementId));
    expect(rows).toHaveLength(4);
    expect(
      rows.filter((row) => row.reason === "replacement_failed_candidate"),
    ).toHaveLength(3);
  });

  it("persists the origin on source and candidate cleanup after failure", async () => {
    const candidate = await target(2, true);
    await processing.markFailed(
      candidate.replacementId,
      "invalid-zip-layout",
      "request-complete",
    );
    const rows = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.replacementId, candidate.replacementId));
    expect(rows).toHaveLength(3);
    expect(
      rows.every((row) => row.originRequestId === "request-complete"),
    ).toBe(true);
  });

  it("CHR3-CLN-03 ready transition atomically schedules source ZIP cleanup", async () => {
    const candidate = await target(2, true);
    expect(await processing.markReady(candidate.replacementId)).toBe(true);
    const rows = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.replacementId, candidate.replacementId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe("replacement_source_zip");
  });

  it("persists the origin on successful source cleanup", async () => {
    const candidate = await target(1, true);
    expect(
      await processing.markReady(candidate.replacementId, "request-complete"),
    ).toBe(true);
    const rows = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.replacementId, candidate.replacementId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.originRequestId).toBe("request-complete");
  });

  it("CHR3-CLN-04 ready candidate media is protected", async () => {
    const candidate = await target(1, true);
    await processing.markReady(candidate.replacementId);
    expect(
      await cleanup.isSafeToDelete({
        id: randomUUID(),
        replacementId: candidate.replacementId,
        storageKey: candidate.items[0]?.candidateStorageKey ?? "missing",
        storageProfileId: "00000000-0000-4000-8000-000000000001",
        reason: "replacement_failed_candidate",
        attempts: 1,
      }),
    ).toBe(false);
  });

  it("CHR3-CLN-05 completing candidate media is protected", async () => {
    const candidate = await target(1, true);
    await database.db
      .update(chapterReplacementOperations)
      .set({ status: "completing" })
      .where(eq(chapterReplacementOperations.id, candidate.replacementId));
    expect(
      await cleanup.isSafeToDelete({
        id: randomUUID(),
        replacementId: candidate.replacementId,
        storageKey: candidate.items[0]?.candidateStorageKey ?? "missing",
        storageProfileId: "00000000-0000-4000-8000-000000000001",
        reason: "replacement_failed_candidate",
        attempts: 1,
      }),
    ).toBe(false);
  });

  it("CHR3-CLN-06 completed candidate media is protected", async () => {
    const candidate = await target(1, true);
    await database.db
      .update(chapterReplacementOperations)
      .set({
        status: "completed",
        previousImageCount: 1,
        resultImageCount: 1,
        retainedImageCount: 1,
        createdImageCount: 0,
        retiredImageCount: 0,
        completedAt: new Date(),
      })
      .where(eq(chapterReplacementOperations.id, candidate.replacementId));
    expect(
      await cleanup.isSafeToDelete({
        id: randomUUID(),
        replacementId: candidate.replacementId,
        storageKey: candidate.items[0]?.candidateStorageKey ?? "missing",
        storageProfileId: "00000000-0000-4000-8000-000000000001",
        reason: "replacement_failed_candidate",
        attempts: 1,
      }),
    ).toBe(false);
  });

  it("CHR3-CLN-07 cleanup rows require no fake imageId", async () => {
    const candidate = await target();
    await processing.markFailed(candidate.replacementId, "invalid-zip-layout");
    const [row] = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.replacementId, candidate.replacementId));
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("imageId");
  });

  it("CHR3-CLN-08 duplicate cleanup scheduling is idempotent", async () => {
    const candidate = await target(2, true);
    await processing.markFailed(candidate.replacementId, "invalid-zip-layout");
    await processing.markFailed(candidate.replacementId, "invalid-zip-layout");
    const rows = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.replacementId, candidate.replacementId));
    expect(rows).toHaveLength(3);
  });
});
