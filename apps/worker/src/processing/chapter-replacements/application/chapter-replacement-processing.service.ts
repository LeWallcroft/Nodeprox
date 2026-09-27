import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { StoragePort } from "@nodeprox/storage/port";
import type { ProcessChapterReplacementInput } from "@nodeprox/types";
import type { ZipExtractorPort } from "../../application/ports.js";
import type { ValidatedImage } from "../../domain/image-policy.js";
import { createChapterCandidateIdentity } from "../domain/chapter-candidate-key.js";
import type {
  ChapterReplacementManifestItem,
  ChapterReplacementProcessingRepositoryPort,
  PlannedChapterReplacementItem,
} from "./ports.js";

const terminalValidationCodes = new Set([
  "zip-entry-limit-exceeded",
  "invalid-zip-path",
  "invalid-zip-layout",
  "duplicate-image-filename",
  "duplicate-image-sort-order",
  "zip-size-limit-exceeded",
  "zip-has-no-images",
  "invalid-image-filename",
  "invalid-image-order",
  "unsupported-image-extension",
  "image-magic-mismatch",
  "invalid-zip-archive",
  "chapter-replacement-manifest-mismatch",
  "candidate-storage-mismatch",
  "stored-image-metadata-mismatch",
]);

export class ChapterReplacementProcessingService {
  constructor(
    private readonly repository: ChapterReplacementProcessingRepositoryPort,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly extractor: ZipExtractorPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(input: ProcessChapterReplacementInput): Promise<void> {
    const claim = await this.repository.claimForProcessing(input);
    if (claim.outcome !== "process") return;
    try {
      const storage = await this.storageExecution.storageFor(
        claim.context.storageProfileId,
      );
      const source = await storage.get(claim.context.sourceStorageKey);
      const extracted = await this.inspectCandidate(source);
      const proposed = extracted.map((image) => planItem(claim.context, image));
      const manifest = await this.repository.createOrLoadManifest(
        claim.context.replacementId,
        proposed,
      );
      assertManifestMatches(manifest, extracted);

      for (const item of manifest) {
        if (item.storedAt) continue;
        const image = extracted.find(
          (candidate) => candidate.sortOrder === item.sortOrder,
        );
        if (!image) throw new Error("chapter-replacement-manifest-mismatch");
        if (item.storageProfileId !== claim.context.storageProfileId)
          throw new Error("chapter-replacement-profile-mismatch");
        const stored = await this.storeOrRecover(storage, item, image);
        const acknowledged = await this.repository.markCandidateStored({
          replacementId: claim.context.replacementId,
          itemId: item.id,
          sizeBytes: stored.sizeBytes,
          ...(stored.etag ? { etag: stored.etag } : {}),
          storedAt: this.now(),
        });
        if (!acknowledged)
          throw new Error("chapter-replacement-storage-evidence-conflict");
      }

      if (
        !(await this.repository.markReady(
          claim.context.replacementId,
          input.originRequestId,
        ))
      )
        throw new Error("chapter-replacement-ready-conflict");
    } catch (error) {
      const code = errorCode(error);
      if (!terminalValidationCodes.has(code)) throw error;
      await this.repository.markFailed(
        claim.context.replacementId,
        code,
        input.originRequestId,
      );
    } finally {
      await this.extractor.dispose().catch(() => undefined);
    }
  }

  private async storeOrRecover(
    storage: StoragePort,
    item: ChapterReplacementManifestItem,
    image: ValidatedImage,
  ): Promise<{ sizeBytes: number; etag?: string }> {
    if (await storage.exists(item.candidateStorageKey)) {
      const evidence = await checksumStream(
        await storage.get(item.candidateStorageKey),
      );
      if (
        evidence.sizeBytes !== item.sizeBytes ||
        evidence.checksum !== item.checksum
      )
        throw new Error("candidate-storage-mismatch");
      return { sizeBytes: evidence.sizeBytes };
    }
    const stored = await storage.put({
      key: item.candidateStorageKey,
      body: this.extractor.readImage(image),
      contentType: item.contentType,
      sizeBytes: item.sizeBytes,
    });
    if (
      stored.key !== item.candidateStorageKey ||
      stored.sizeBytes !== item.sizeBytes ||
      stored.contentType !== item.contentType
    )
      throw new Error("stored-image-metadata-mismatch");
    return stored;
  }

  private async inspectCandidate(source: Readable) {
    try {
      return await this.extractor.inspect(source);
    } catch (error) {
      const code = errorCode(error);
      throw new Error(
        terminalValidationCodes.has(code) ? code : "invalid-zip-archive",
      );
    }
  }
}

function planItem(
  context: {
    replacementId: string;
    storageProfileId: string;
    seriesSlug: string;
    chapterPublicKey: string;
    activeImages: readonly {
      sortOrder: number;
      logicalFilename: string;
      currentVersion: number;
    }[];
  },
  image: ValidatedImage,
): PlannedChapterReplacementItem {
  const retained = (context.activeImages ?? []).find(
    (active) => active.sortOrder === image.sortOrder,
  );
  const candidate = createChapterCandidateIdentity({
    seriesSlug: context.seriesSlug,
    chapterPublicKey: context.chapterPublicKey,
    replacementId: context.replacementId,
    logicalFilename: retained?.logicalFilename ?? image.filename,
    version: retained ? retained.currentVersion + 1 : 1,
    extension: image.extension,
  });
  return {
    id: candidate.itemId,
    operationId: context.replacementId,
    storageProfileId: context.storageProfileId,
    sortOrder: image.sortOrder,
    candidateStorageKey: candidate.storageKey,
    physicalFilename: candidate.physicalFilename,
    originalFilename: image.filename,
    contentType: image.contentType,
    sizeBytes: image.sizeBytes,
    checksum: image.checksum,
  };
}

function assertManifestMatches(
  manifest: readonly ChapterReplacementManifestItem[],
  extracted: readonly ValidatedImage[],
): void {
  if (manifest.length !== extracted.length)
    throw new Error("chapter-replacement-manifest-mismatch");
  for (const [index, item] of manifest.entries()) {
    const image = extracted[index];
    if (
      !image ||
      item.sortOrder !== image.sortOrder ||
      item.storageProfileId !== manifest[0]?.storageProfileId ||
      item.originalFilename !== image.filename ||
      item.contentType !== image.contentType ||
      item.sizeBytes !== image.sizeBytes ||
      item.checksum !== image.checksum
    )
      throw new Error("chapter-replacement-manifest-mismatch");
  }
}

async function checksumStream(stream: Readable) {
  const hash = createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += bytes.length;
    hash.update(bytes);
  }
  return { sizeBytes, checksum: hash.digest("hex") };
}

function errorCode(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "chapter-replacement-processing-failed";
}
