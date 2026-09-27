import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, inject, it } from "vitest";
import { DrizzleChapterReplacementProcessingRepository } from "../../apps/api/src/modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import { DrizzleChapterReplacementProcessingWorkerRepository } from "../../apps/worker/src/processing/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  chapterReplacementOperations,
  chapterReplacementProcessingOutbox,
  chapters,
  images,
  storageCleanupOutbox,
} from "../../database/schema/index.js";
import { createReplacementChapter } from "./helpers/chapter-replacement-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const apiRepository = new DrizzleChapterReplacementProcessingRepository(
  database.db,
);
const workerRepository =
  new DrizzleChapterReplacementProcessingWorkerRepository(database.db);

afterAll(async () => database.sql.end());

async function pending() {
  const chapter = await createReplacementChapter(database.db, 2);
  const replacementId = randomUUID();
  const operation = await apiRepository.createPending({
    id: replacementId,
    chapterId: chapter.chapterId,
    requestedByUserId: chapter.userId,
    candidateZipStorageKey: `chapter-replacements/${chapter.chapterId}/${replacementId}/source.zip`,
    storageProfileId: "00000000-0000-4000-8000-000000000001",
    originalFilename: "replacement.zip",
    contentType: "application/zip",
    sizeBytes: 100,
  });
  if (!operation) throw new Error("fixture-operation-conflict");
  return { chapter, operation };
}

async function uploaded() {
  const target = await pending();
  const operation = await apiRepository.markUploadedAndEnqueue({
    replacementId: target.operation.id,
    chapterId: target.chapter.chapterId,
    etag: "zip-etag",
  });
  if (!operation) throw new Error("fixture-upload-conflict");
  return { ...target, operation };
}

function plan(target: Awaited<ReturnType<typeof uploaded>>, count = 2) {
  return Array.from({ length: count }, (_, index) => {
    const id = randomUUID();
    return {
      id,
      operationId: target.operation.id,
      sortOrder: index + 1,
      candidateStorageKey: `Media/${target.chapter.seriesSlug}/${target.chapter.chapterPublicKey}/${target.operation.id}-${id}.png`,
      storageProfileId: target.operation.storageProfileId,
      physicalFilename: `${target.operation.id}-${id}.png`,
      originalFilename: `${String(index + 1).padStart(2, "0")}.png`,
      contentType: "image/png",
      sizeBytes: 16,
      checksum: `checksum-${index}`,
    };
  });
}

describe("CHR3 processing persistence", () => {
  it("creates pending operation without mutating ready Chapter", async () => {
    const target = await pending();
    const [chapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, target.chapter.chapterId));
    expect(target.operation.status).toBe("pending_upload");
    expect(chapter?.status).toBe("ready");
  });

  it("commits uploaded state and one processing intent atomically", async () => {
    const target = await uploaded();
    const intents = await database.db
      .select()
      .from(chapterReplacementProcessingOutbox)
      .where(
        eq(
          chapterReplacementProcessingOutbox.replacementId,
          target.operation.id,
        ),
      );
    expect(target.operation).toMatchObject({
      status: "uploaded",
      etag: "zip-etag",
    });
    expect(intents).toHaveLength(1);
  });

  it("persists and reads the completion request origin on its durable intent", async () => {
    const target = await pending();
    await apiRepository.markUploadedAndEnqueue({
      replacementId: target.operation.id,
      chapterId: target.chapter.chapterId,
      etag: "zip-etag",
      originRequestId: "request-complete",
    });
    const intents = await database.db
      .select()
      .from(chapterReplacementProcessingOutbox)
      .where(
        eq(
          chapterReplacementProcessingOutbox.replacementId,
          target.operation.id,
        ),
      );
    expect(intents).toHaveLength(1);
    expect(intents[0]?.originRequestId).toBe("request-complete");
    expect(
      (await apiRepository.findPending(100)).find(
        (intent) => intent.replacementId === target.operation.id,
      )?.originRequestId,
    ).toBe("request-complete");
  });

  it("repeated upload completion creates no duplicate intent", async () => {
    const target = await uploaded();
    await apiRepository.markUploadedAndEnqueue({
      replacementId: target.operation.id,
      chapterId: target.chapter.chapterId,
      etag: "zip-etag",
    });
    const intents = await database.db
      .select()
      .from(chapterReplacementProcessingOutbox)
      .where(
        eq(
          chapterReplacementProcessingOutbox.replacementId,
          target.operation.id,
        ),
      );
    expect(intents).toHaveLength(1);
  });

  it("claims uploaded operation as processing without Chapter media lock", async () => {
    const target = await uploaded();
    const claim = await workerRepository.claimForProcessing({
      replacementId: target.operation.id,
      chapterId: target.chapter.chapterId,
    });
    expect(claim.outcome).toBe("process");
    const [operation] = await database.db
      .select({ status: chapterReplacementOperations.status })
      .from(chapterReplacementOperations)
      .where(eq(chapterReplacementOperations.id, target.operation.id));
    expect(operation?.status).toBe("processing");
  });

  it("persists and reloads one immutable manifest plan", async () => {
    const target = await uploaded();
    await workerRepository.claimForProcessing({
      replacementId: target.operation.id,
      chapterId: target.chapter.chapterId,
    });
    const first = await workerRepository.createOrLoadManifest(
      target.operation.id,
      plan(target),
    );
    const second = await workerRepository.createOrLoadManifest(
      target.operation.id,
      plan(target, 3),
    );
    expect(second.map((item) => item.id)).toEqual(first.map((item) => item.id));
    expect(second).toHaveLength(2);
  });

  it("stored evidence gates ready and schedules source cleanup", async () => {
    const target = await uploaded();
    await workerRepository.claimForProcessing({
      replacementId: target.operation.id,
      chapterId: target.chapter.chapterId,
    });
    const manifest = await workerRepository.createOrLoadManifest(
      target.operation.id,
      plan(target),
    );
    expect(await workerRepository.markReady(target.operation.id)).toBe(false);
    for (const item of manifest)
      await workerRepository.markCandidateStored({
        replacementId: target.operation.id,
        itemId: item.id,
        sizeBytes: item.sizeBytes,
        etag: `etag-${item.id}`,
        storedAt: new Date(),
      });
    expect(await workerRepository.markReady(target.operation.id)).toBe(true);
    const cleanup = await database.db
      .select()
      .from(storageCleanupOutbox)
      .where(eq(storageCleanupOutbox.replacementId, target.operation.id));
    expect(cleanup).toHaveLength(1);
  });

  it("processing through ready leaves published Images and Chapter status unchanged", async () => {
    const target = await uploaded();
    const before = await database.db
      .select({ id: images.id, currentVersionId: images.currentVersionId })
      .from(images)
      .where(eq(images.chapterId, target.chapter.chapterId));
    await workerRepository.claimForProcessing({
      replacementId: target.operation.id,
      chapterId: target.chapter.chapterId,
    });
    const manifest = await workerRepository.createOrLoadManifest(
      target.operation.id,
      plan(target),
    );
    for (const item of manifest)
      await workerRepository.markCandidateStored({
        replacementId: target.operation.id,
        itemId: item.id,
        sizeBytes: item.sizeBytes,
        storedAt: new Date(),
      });
    await workerRepository.markReady(target.operation.id);
    const after = await database.db
      .select({ id: images.id, currentVersionId: images.currentVersionId })
      .from(images)
      .where(eq(images.chapterId, target.chapter.chapterId));
    const [chapter] = await database.db
      .select({ status: chapters.status })
      .from(chapters)
      .where(eq(chapters.id, target.chapter.chapterId));
    expect(after).toEqual(before);
    expect(chapter?.status).toBe("ready");
  });
});
