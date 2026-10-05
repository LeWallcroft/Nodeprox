import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ZipExtractorPort } from "../../apps/worker/src/processing/application/ports.js";
import { ChapterReplacementProcessingService } from "../../apps/worker/src/processing/chapter-replacements/application/chapter-replacement-processing.service.js";
import type {
  ChapterReplacementManifestItem,
  ChapterReplacementProcessingRepositoryPort,
  PlannedChapterReplacementItem,
} from "../../apps/worker/src/processing/chapter-replacements/application/ports.js";
import type { ValidatedImage } from "../../apps/worker/src/processing/domain/image-policy.js";
import type { StoragePort, StoredObject } from "@nodeprox/storage/port";
import {
  legacyStorageExecution,
  legacyStorageProfileId,
} from "../helpers/storage-execution.js";

const replacementId = "33333333-3333-4333-8333-333333333333";
const chapterId = "11111111-1111-4111-8111-111111111111";

function image(order: number): ValidatedImage & { bytes: Buffer } {
  const bytes = Buffer.from(`valid-image-${order}`);
  return {
    filename: `${String(order).padStart(2, "0")}.png`,
    extension: "png",
    contentType: "image/png",
    sortOrder: order,
    sizeBytes: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
    warnings: [],
    tempPath: `/${order}.png`,
    bytes,
  };
}

class MemoryRepository implements ChapterReplacementProcessingRepositoryPort {
  status:
    | "uploaded"
    | "processing"
    | "ready"
    | "completed"
    | "failed"
    | "retry_exhausted" = "uploaded";
  manifest: ChapterReplacementManifestItem[] = [];
  cleanup: string[] = [];
  calls: string[] = [];
  failEvidenceOnce = false;
  readyOriginRequestId: string | undefined;
  failedOriginRequestId: string | undefined;
  activeImages: Array<{
    sortOrder: number;
    logicalFilename: string;
    currentVersion: number;
  }> = [];
  admissionManifest: Array<{
    filename: string;
    extension: string;
    contentType: string;
    sortOrder: number;
    sizeBytes: number;
    checksumSha256: string;
    warnings: readonly [];
  }> = [];

  async loadAdmissionManifest() {
    return this.admissionManifest;
  }
  async markRetryExhausted() {
    this.status = "retry_exhausted";
    return true;
  }
  async markRetryableFailed() {
    return;
  }

  async claimForProcessing(input: {
    replacementId: string;
    chapterId: string;
  }) {
    this.calls.push("claim");
    if (input.replacementId !== replacementId || input.chapterId !== chapterId)
      return { outcome: "not-found" as const };
    if (["ready", "completed", "failed"].includes(this.status))
      return { outcome: "noop" as const };
    this.status = "processing";
    return {
      outcome: "process" as const,
      context: {
        replacementId,
        chapterId,
        requestedByUserId: "user",
        sourceStorageKey: `chapter-replacements/${chapterId}/${replacementId}/source.zip`,
        storageProfileId: legacyStorageProfileId,
        seriesSlug: "one-piece",
        chapterPublicKey: "chapter-1",
        status: "processing" as const,
        activeImages: this.activeImages,
      },
    };
  }

  async createOrLoadManifest(
    _replacementId: string,
    plan: readonly PlannedChapterReplacementItem[],
  ) {
    this.calls.push("manifest");
    if (this.manifest.length === 0)
      this.manifest = plan.map((item) => ({
        ...item,
        etag: null,
        storedAt: null,
      }));
    return this.manifest;
  }

  async markCandidateStored(input: {
    itemId: string;
    sizeBytes: number;
    etag?: string;
    storedAt: Date;
  }) {
    this.calls.push("evidence");
    if (this.failEvidenceOnce) {
      this.failEvidenceOnce = false;
      throw new Error("database-temporary-failure");
    }
    const item = this.manifest.find(
      (candidate) => candidate.id === input.itemId,
    );
    if (!item || this.status !== "processing") return false;
    item.sizeBytes = input.sizeBytes;
    item.etag = input.etag ?? null;
    item.storedAt = input.storedAt;
    return true;
  }

  async markReady(_id: string, originRequestId?: string) {
    this.readyOriginRequestId = originRequestId;
    this.calls.push("ready");
    if (this.status === "ready") return true;
    if (
      this.status !== "processing" ||
      this.manifest.some((item) => !item.storedAt)
    )
      return false;
    this.status = "ready";
    this.cleanup.push("source");
    return true;
  }

  async markFailed(_id: string, code: string, originRequestId?: string) {
    this.failedOriginRequestId = originRequestId;
    this.calls.push(`failed:${code}`);
    if (this.status !== "processing") return false;
    this.status = "failed";
    this.cleanup.push(
      "source",
      ...this.manifest.map((item) => item.candidateStorageKey),
    );
    return true;
  }
}

class MemoryStorage implements StoragePort {
  objects = new Map<string, Buffer>();
  puts: string[] = [];
  failPut = false;

  async put(input: {
    key: string;
    body: { sizeBytes: number; open(): NodeJS.ReadableStream };
    contentType: string;
    sizeBytes: number;
  }): Promise<StoredObject> {
    if (this.failPut) throw new Error("storage-temporary-failure");
    const chunks: Buffer[] = [];
    for await (const chunk of input.body.open() as Readable)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    this.objects.set(input.key, Buffer.concat(chunks));
    this.puts.push(input.key);
    return {
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
      etag: `etag-${this.puts.length}`,
    };
  }
  async get(key: string) {
    const value = this.objects.get(key) ?? Buffer.from("zip");
    return Readable.from(value);
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
  async exists(key: string) {
    return this.objects.has(key);
  }
}

function harness(count = 3) {
  const images = Array.from({ length: count }, (_, index) => image(index + 1));
  const repository = new MemoryRepository();
  repository.admissionManifest = images.map((entry) => ({
    filename: entry.filename,
    extension: entry.extension,
    contentType: entry.contentType,
    sortOrder: entry.sortOrder,
    sizeBytes: entry.sizeBytes,
    checksumSha256: entry.checksum,
    warnings: [],
  }));
  const storage = new MemoryStorage();
  const extractor: ZipExtractorPort = {
    inspect: vi.fn().mockResolvedValue(images),
    readImage: vi.fn((candidate: ValidatedImage) => {
      const match = images.find(
        (entry) => entry.tempPath === candidate.tempPath,
      );
      return Readable.from(match?.bytes ?? Buffer.alloc(0));
    }),
    replayableImage: vi.fn((candidate: ValidatedImage) => {
      const match = images.find(
        (entry) => entry.tempPath === candidate.tempPath,
      );
      const bytes = match?.bytes ?? Buffer.alloc(0);
      return { sizeBytes: bytes.length, open: () => Readable.from([bytes]) };
    }),
    dispose: vi.fn().mockResolvedValue(undefined),
  };
  const service = new ChapterReplacementProcessingService(
    repository,
    legacyStorageExecution(storage),
    extractor,
  );
  const input = { replacementId, chapterId };
  return { images, repository, storage, extractor, service, input };
}

describe("CHR3 replacement Worker processing", () => {
  it("CHR3-WRK-01 uploaded operation claims processing", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(target.repository.calls[0]).toBe("claim");
  });

  it("CHR3-WRK-02 reuses the injected ZIP validation boundary", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(target.extractor.inspect).toHaveBeenCalledTimes(1);
  });

  it("CHR3-WRK-03 preserves canonical ZIP order", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(target.repository.manifest.map((item) => item.sortOrder)).toEqual([
      1, 2, 3,
    ]);
  });

  it("CHR3-WRK-04 persists the complete plan before candidate PUT evidence", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(target.repository.calls.indexOf("manifest")).toBeLessThan(
      target.repository.calls.indexOf("evidence"),
    );
    expect(target.repository.manifest).toHaveLength(3);
  });

  it("CHR3-WRK-05 creates versioned final-compatible keys", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(
      target.repository.manifest.map((item) => item.candidateStorageKey),
    ).toEqual([
      "Media/one-piece/chapter-1/01.png",
      "Media/one-piece/chapter-1/02.png",
      "Media/one-piece/chapter-1/03.png",
    ]);
    expect(
      target.repository.manifest.some((item) =>
        /^\d{2}\.(?:jpg|jpeg|png|webp|gif)$/.test(item.physicalFilename),
      ),
    ).toBe(true);
  });

  it("CHR3-WRK-05A retains logical names and advances their versions", async () => {
    const target = harness(2);
    target.repository.activeImages = [
      { sortOrder: 1, logicalFilename: "01.jpg", currentVersion: 2 },
      { sortOrder: 2, logicalFilename: "02.png", currentVersion: 1 },
    ];

    await target.service.process(target.input);

    expect(
      target.repository.manifest.map((item) => item.physicalFilename),
    ).toEqual(["01_v3.png", "02_v2.png"]);
  });

  it("CHR3-WRK-06 persists stored evidence for every candidate", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(
      target.repository.manifest.every((item) => item.storedAt && item.etag),
    ).toBe(true);
  });

  it("CHR3-WRK-07 full manifest transitions to ready", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(target.repository.status).toBe("ready");
  });

  it("propagates the durable origin to successful cleanup scheduling", async () => {
    const target = harness();
    await target.service.process({
      ...target.input,
      originRequestId: "request-complete",
    });
    expect(target.repository.readyOriginRequestId).toBe("request-complete");
  });

  it("CHR3-WRK-08 ready duplicate delivery is a no-op", async () => {
    const target = harness();
    target.repository.status = "ready";
    await target.service.process(target.input);
    expect(target.extractor.inspect).not.toHaveBeenCalled();
  });

  it("CHR3-WRK-09 completed duplicate delivery is a no-op", async () => {
    const target = harness();
    target.repository.status = "completed";
    await target.service.process(target.input);
    expect(target.storage.puts).toHaveLength(0);
  });

  it("CHR3-WRK-10 terminal invalid ZIP becomes failed", async () => {
    const target = harness();
    vi.mocked(target.extractor.inspect).mockRejectedValue(
      new Error("invalid-zip-path"),
    );
    await target.service.process(target.input);
    expect(target.repository.status).toBe("failed");
  });

  it("propagates the durable origin to failed cleanup scheduling", async () => {
    const target = harness();
    vi.mocked(target.extractor.inspect).mockRejectedValue(
      new Error("invalid-zip-path"),
    );
    await target.service.process({
      ...target.input,
      originRequestId: "request-complete",
    });
    expect(target.repository.failedOriginRequestId).toBe("request-complete");
  });

  it("CHR3-WRK-11 transient storage failure remains processing and retryable", async () => {
    const target = harness();
    target.storage.failPut = true;
    await expect(target.service.process(target.input)).rejects.toThrow(
      "storage-temporary-failure",
    );
    expect(target.repository.status).toBe("processing");
  });

  it("CHR3-WRK-12 processing has no canonical activation dependency", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(Object.keys(target.repository)).not.toContain("activate");
  });
});

describe("CHR3 replacement crash recovery", () => {
  it("CHR3-CRASH-01 uploaded durable state can be processed after request crash", async () => {
    const target = harness();
    await target.service.process(target.input);
    expect(target.repository.status).toBe("ready");
  });

  it("CHR3-CRASH-02 PUT-before-DB recovery verifies the same planned key", async () => {
    const target = harness(1);
    target.repository.failEvidenceOnce = true;
    await expect(target.service.process(target.input)).rejects.toThrow(
      "database-temporary-failure",
    );
    const plannedKey = target.repository.manifest[0]?.candidateStorageKey;
    await target.service.process(target.input);
    expect(target.storage.puts).toEqual([plannedKey]);
    expect(target.repository.manifest[0]?.storedAt).toBeInstanceOf(Date);
  });

  it("CHR3-CRASH-03 partial manifest resumes the same item IDs and keys", async () => {
    const target = harness(20);
    const original = target.repository.markCandidateStored.bind(
      target.repository,
    );
    let acknowledgements = 0;
    target.repository.markCandidateStored = async (input) => {
      acknowledgements += 1;
      if (acknowledgements === 18)
        throw new Error("database-temporary-failure");
      return original(input);
    };
    await expect(target.service.process(target.input)).rejects.toThrow();
    const identities = target.repository.manifest.map((item) => [
      item.id,
      item.candidateStorageKey,
    ]);
    target.repository.markCandidateStored = original;
    await target.service.process(target.input);
    expect(
      target.repository.manifest.map((item) => [
        item.id,
        item.candidateStorageKey,
      ]),
    ).toEqual(identities);
    expect(
      target.repository.manifest.filter((item) => item.storedAt),
    ).toHaveLength(20);
  });

  it("CHR3-CRASH-04 complete manifest before ready converges on retry", async () => {
    const target = harness();
    const original = target.repository.markReady.bind(target.repository);
    target.repository.markReady = vi
      .fn()
      .mockRejectedValueOnce(new Error("database-temporary-failure"));
    await expect(target.service.process(target.input)).rejects.toThrow();
    target.repository.markReady = original;
    await target.service.process(target.input);
    expect(target.repository.status).toBe("ready");
    expect(target.storage.puts).toHaveLength(3);
  });

  it("CHR3-CRASH-05 duplicate delivery creates no duplicate manifest", async () => {
    const target = harness();
    await Promise.all([
      target.service.process(target.input),
      target.service.process(target.input),
    ]);
    expect(
      new Set(target.repository.manifest.map((item) => item.id)).size,
    ).toBe(3);
    expect(target.repository.manifest).toHaveLength(3);
  });

  it("CHR3-CRASH-06 stale delivery cannot move ready/completed backwards", async () => {
    const target = harness();
    target.repository.status = "ready";
    await target.service.process(target.input);
    expect(target.repository.status).toBe("ready");
    target.repository.status = "completed";
    await target.service.process(target.input);
    expect(target.repository.status).toBe("completed");
  });

  it("CHR3-CRASH-07 ready scheduling remains one logical source cleanup", async () => {
    const target = harness();
    await target.service.process(target.input);
    await target.service.process(target.input);
    expect(target.repository.cleanup).toEqual(["source"]);
  });
});
