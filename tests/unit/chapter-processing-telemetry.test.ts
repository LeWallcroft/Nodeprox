import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { StorageProviderUnavailableError } from "@nodeprox/storage/errors";
import { StorageObjectAlreadyExistsError } from "@nodeprox/storage/port";
import { ChapterProcessingService } from "../../apps/worker/src/processing/application/chapter-processing.service.js";
import { BufferedPerformanceObserver } from "../../apps/worker/src/observability/infrastructure/buffered-performance-observer.js";

const bytes = Buffer.from("img");
const checksum = createHash("sha256").update(bytes).digest("hex");
const image = {
  filename: "01.jpg",
  extension: "jpg",
  contentType: "image/jpeg",
  sortOrder: 1,
  sizeBytes: bytes.length,
  checksum,
  warnings: [],
  tempPath: "temporary-image",
};
const input = {
  chapterId: "chapter-1",
  seriesId: "series-1",
  uploadId: "upload-1",
  sourceStorageKey: "private/source.zip",
};

type Scenario =
  | "success"
  | "transient"
  | "equivalent"
  | "conflict"
  | "manifest"
  | "onCreated"
  | "skip";

async function run(scenario: Scenario, enabled: boolean) {
  const calls: string[] = [];
  const emit = vi.fn();
  const observer = enabled ? new BufferedPerformanceObserver(emit) : undefined;
  const repository = {
    findUpload: vi.fn(async () =>
      scenario === "skip"
        ? null
        : {
            chapterId: input.chapterId,
            seriesId: input.seriesId,
            storageKey: input.sourceStorageKey,
            status: "uploaded",
            chapterStatus: "uploaded",
            storageProfileId: "profile-1",
            seriesPublicSlug: "series",
            chapterPublicKey: "chapter",
            createdBy: "user-1",
          },
    ),
    claimChapter: vi.fn(async () => ({
      outcome: "claimed",
      attempt: { id: "attempt-1", attemptNumber: 1 },
    })),
    loadLatestAcceptedManifest: vi.fn(async () => [
      {
        filename: image.filename,
        sortOrder: image.sortOrder,
        sizeBytes: image.sizeBytes,
        checksumSha256: scenario === "manifest" ? "f".repeat(64) : checksum,
        contentType: image.contentType,
      },
    ]),
    reserveCandidate: vi.fn(async () => {
      calls.push("reserve");
    }),
    markCandidate: vi.fn(
      async (_attempt: string, _key: string, state: string) => {
        calls.push(`mark:${state}`);
        if (scenario === "onCreated" && state === "created")
          throw new Error("mark-created-failed");
      },
    ),
    replaceImagesAndMarkReady: vi.fn(async () => {
      calls.push("finalize");
    }),
    markFailed: vi.fn(
      async (
        _chapter: string,
        _upload: string,
        _attempt: string,
        failure: { disposition: string },
      ) => {
        calls.push(`failed:${failure.disposition}`);
      },
    ),
  };
  const storage = {
    put: vi.fn(async (write: { key: string }) => {
      calls.push("put");
      if (scenario === "transient")
        throw new StorageProviderUnavailableError({ httpStatus: 503 });
      if (scenario === "equivalent" || scenario === "conflict")
        throw new StorageObjectAlreadyExistsError();
      return {
        key: write.key,
        sizeBytes: bytes.length,
        contentType: image.contentType,
      };
    }),
    head: vi.fn(async () => {
      calls.push("head");
      return { sizeBytes: bytes.length, contentType: image.contentType };
    }),
    get: vi.fn(async (key: string) => {
      calls.push("get");
      return Readable.from([
        key === input.sourceStorageKey
          ? Buffer.from("zip")
          : scenario === "conflict"
            ? Buffer.from("bad")
            : bytes,
      ]);
    }),
    delete: vi.fn(async () => {
      calls.push("delete");
    }),
  };
  const extractor = {
    inspect: vi.fn(async (stream: Readable) => {
      for await (const _chunk of stream) {
        /* consume ZIP */
      }
      return [image];
    }),
    replayableImage: vi.fn(() => ({
      sizeBytes: bytes.length,
      open: () => Readable.from([bytes]),
    })),
    dispose: vi.fn(async () => {
      calls.push("dispose");
    }),
  };
  const service = new ChapterProcessingService(
    repository as never,
    { storageFor: vi.fn(async () => storage) } as never,
    extractor as never,
    { append: vi.fn(async () => undefined) },
    undefined,
    observer,
  );
  let failure: unknown;
  try {
    await service.process(input);
  } catch (error) {
    failure = error;
  }
  observer?.finish({
    jobName: "chapter.process",
    jobId: "job-1",
    jobAttempt: 1,
    outcome: failure ? "error" : "success",
    handlerDurationMs: 1,
  });
  return {
    calls,
    repository,
    storage,
    extractor,
    failure,
    emit,
    summary: emit.mock.calls[0]?.[0],
  };
}

describe("chapter processing telemetry parity", () => {
  for (const scenario of [
    "success",
    "transient",
    "equivalent",
    "conflict",
    "manifest",
    "onCreated",
    "skip",
  ] as const) {
    it(`preserves calls, outcome and cleanup with telemetry ${scenario}`, async () => {
      const off = await run(scenario, false);
      const on = await run(scenario, true);
      expect(on.calls).toEqual(off.calls);
      expect(on.failure?.constructor).toBe(off.failure?.constructor);
      expect((on.failure as Error | undefined)?.message).toBe(
        (off.failure as Error | undefined)?.message,
      );
      expect(on.repository.replaceImagesAndMarkReady.mock.calls.length).toBe(
        off.repository.replaceImagesAndMarkReady.mock.calls.length,
      );
      expect(on.storage.put.mock.calls.length).toBe(
        off.storage.put.mock.calls.length,
      );
      expect(on.storage.head.mock.calls.length).toBe(
        off.storage.head.mock.calls.length,
      );
      expect(on.storage.get.mock.calls.length).toBe(
        off.storage.get.mock.calls.length,
      );
      expect(off.emit).not.toHaveBeenCalled();
      expect(on.emit).toHaveBeenCalledOnce();
      expect(on.summary).toMatchObject({
        jobOutcome: on.failure ? "error" : "success",
        workOutcome: on.failure
          ? "failed"
          : scenario === "skip"
            ? "skipped"
            : "processed",
      });
      if (scenario === "equivalent") {
        expect(
          on.summary.stages["storage.put_with_existence_check"],
        ).toMatchObject({ count: 1, errorCount: 0 });
        expect(on.calls).toContain("mark:reused");
        expect(on.calls).not.toContain("mark:created");
      }
      if (scenario === "conflict") {
        expect(on.calls).not.toContain("finalize");
        expect(on.calls).not.toContain("delete");
      }
      if (scenario === "manifest") {
        expect(on.storage.put).not.toHaveBeenCalled();
        expect(on.repository.reserveCandidate).not.toHaveBeenCalled();
      }
      if (scenario === "onCreated") {
        expect(on.calls).toEqual(
          expect.arrayContaining(["mark:created", "delete", "mark:cleaned"]),
        );
        expect(on.calls.indexOf("delete")).toBeGreaterThan(
          on.calls.indexOf("failed:retryable"),
        );
      }
      if (scenario === "transient") {
        expect(on.calls).toContain("failed:retryable");
        expect(on.calls).not.toContain("delete");
      }
      if (scenario === "skip") {
        expect(on.summary).toMatchObject({ skipReason: "invalid-upload" });
        expect(on.repository.claimChapter).not.toHaveBeenCalled();
      }
    });
  }
});
