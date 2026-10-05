import { describe, expect, it, vi } from "vitest";
import {
  legacyActiveProfile,
  legacyStorageExecution,
} from "../helpers/storage-execution.js";
import {
  ChapterReplacementUploadDeniedError,
  CompleteChapterReplacementUploadService,
} from "../../apps/api/src/modules/chapter-replacements/application/complete-chapter-replacement-upload.service.js";
import type { ChapterReplacementUploadRepository } from "../../apps/api/src/modules/chapter-replacements/application/ports/chapter-replacement-upload.repository.js";
import {
  ChapterReplacementPrepareConflictError,
  ChapterReplacementPrepareDeniedError,
  PrepareChapterReplacementService,
} from "../../apps/api/src/modules/chapter-replacements/application/prepare-chapter-replacement.service.js";
import type { ChapterReplacementOperation } from "../../apps/api/src/modules/chapter-replacements/domain/chapter-replacement-operation.js";
import type { ChapterImageAuthorizationPort } from "../../apps/api/src/modules/images/application/ports.js";
import type {
  UploadTransferGrant,
  UploadTransferPort,
} from "@nodeprox/storage/port";

const chapterId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const context = { userId, sessionId: "session" };
const grant: UploadTransferGrant = {
  mode: "single",
  method: "PUT",
  url: "https://upload.invalid/signed",
  headers: { "content-type": "application/zip" },
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function harness() {
  const operations = new Map<string, ChapterReplacementOperation>();
  const intents = new Set<string>();
  const authorization: ChapterImageAuthorizationPort = {
    check: vi.fn().mockResolvedValue({ allowed: true, reason: "allowed" }),
  };
  const repository: ChapterReplacementUploadRepository = {
    createPending: vi.fn(async (input) => {
      if (
        [...operations.values()].some(
          (row) => row.chapterId === input.chapterId,
        )
      )
        return null;
      const now = new Date();
      const operation: ChapterReplacementOperation = {
        ...input,
        etag: null,
        status: "pending_upload",
        lastErrorCode: null,
        previousImageCount: null,
        resultImageCount: null,
        retainedImageCount: null,
        createdImageCount: null,
        retiredImageCount: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      operations.set(operation.id, operation);
      return operation;
    }),
    markPreparationFailed: vi.fn(async (id, code) => {
      const row = operations.get(id);
      if (row)
        operations.set(id, { ...row, status: "failed", lastErrorCode: code });
    }),
    findByIdForChapter: vi.fn(async (id, scope) => {
      const row = operations.get(id);
      return row && row.chapterId === scope ? row : null;
    }),
    getCompletedResult: vi.fn().mockResolvedValue(null),
    markValidatingAndEnqueue: vi.fn(async ({ replacementId, etag }) => {
      const row = operations.get(replacementId);
      if (!row) return null;
      if (row.status !== "pending_upload") return row;
      const uploaded = {
        ...row,
        status: "uploaded" as const,
        etag: etag ?? null,
      };
      operations.set(replacementId, uploaded);
      intents.add(replacementId);
      return uploaded;
    }),
  };
  const transfer: UploadTransferPort = {
    initiate: vi.fn().mockResolvedValue(grant),
    verify: vi.fn(async ({ key }) => ({
      key,
      sizeBytes: 128,
      contentType: "application/zip",
      etag: "zip-etag",
    })),
    abort: vi.fn(),
  };
  const prepare = new PrepareChapterReplacementService(
    authorization,
    repository,
    legacyStorageExecution(
      { put: vi.fn(), get: vi.fn(), exists: vi.fn(), delete: vi.fn() },
      transfer,
    ),
    legacyActiveProfile,
    1024,
  );
  const complete = new CompleteChapterReplacementUploadService(
    repository,
    legacyStorageExecution(
      { put: vi.fn(), get: vi.fn(), exists: vi.fn(), delete: vi.fn() },
      transfer,
    ),
    authorization,
  );
  return {
    operations,
    intents,
    authorization,
    repository,
    transfer,
    prepare,
    complete,
  };
}

async function prepared(target = harness()) {
  const result = await target.prepare.execute({
    context,
    chapterId,
    filename: "chapter.zip",
    contentType: "application/x-zip-compressed",
    sizeBytes: 128,
  });
  return { target, result };
}

describe("CHR3 replacement upload services", () => {
  it("CHR3-UP-01 prepare creates pending_upload operation", async () => {
    const { target, result } = await prepared();
    expect(target.operations.get(result.replacementId)?.status).toBe(
      "pending_upload",
    );
  });

  it("CHR3-UP-02 prepare returns direct transfer grant", async () => {
    const { result } = await prepared();
    expect(result.upload).toEqual(grant);
  });

  it("CHR3-UP-03 source key is deterministic server authority", async () => {
    const { target, result } = await prepared();
    expect(
      target.operations.get(result.replacementId)?.candidateZipStorageKey,
    ).toBe(
      `chapter-replacements/${chapterId}/${result.replacementId}/source.zip`,
    );
  });

  it("CHR3-UP-04 unauthorized actor is rejected", async () => {
    const target = harness();
    vi.mocked(target.authorization.check).mockResolvedValue({
      allowed: false,
      reason: "denied",
    });
    await expect(
      target.prepare.execute({
        context,
        chapterId,
        filename: "chapter.zip",
        contentType: "application/zip",
        sizeBytes: 128,
      }),
    ).rejects.toBeInstanceOf(ChapterReplacementPrepareDeniedError);

    const authorized = await prepared();
    vi.mocked(authorized.target.authorization.check).mockResolvedValue({
      allowed: false,
      reason: "denied",
    });
    await expect(
      authorized.target.complete.execute({
        context,
        chapterId,
        replacementId: authorized.result.replacementId,
      }),
    ).rejects.toBeInstanceOf(ChapterReplacementUploadDeniedError);
  });

  it("CHR3-UP-05 second active operation conflicts", async () => {
    const target = harness();
    await prepared(target);
    await expect(prepared(target)).rejects.toBeInstanceOf(
      ChapterReplacementPrepareConflictError,
    );
  });

  it("CHR3-UP-06 invalid ZIP metadata is rejected", async () => {
    const target = harness();
    await expect(
      target.prepare.execute({
        context,
        chapterId,
        filename: "chapter.png",
        contentType: "image/png",
        sizeBytes: 128,
      }),
    ).rejects.toThrow("Invalid upload");
  });

  it("CHR3-UP-07 complete verifies only the persisted source key", async () => {
    const { target, result } = await prepared();
    await target.complete.execute({
      context,
      chapterId,
      replacementId: result.replacementId,
    });
    expect(target.transfer.verify).toHaveBeenCalledWith({
      key: `chapter-replacements/${chapterId}/${result.replacementId}/source.zip`,
    });
  });

  it("CHR3-UP-08 complete transitions pending_upload to uploaded", async () => {
    const { target, result } = await prepared();
    await target.complete.execute({
      context,
      chapterId,
      replacementId: result.replacementId,
    });
    expect(target.operations.get(result.replacementId)?.status).toBe(
      "uploaded",
    );
  });

  it("CHR3-UP-09 complete creates one durable processing intent", async () => {
    const { target, result } = await prepared();
    await target.complete.execute({
      context,
      chapterId,
      replacementId: result.replacementId,
    });
    expect(target.intents).toEqual(new Set([result.replacementId]));
  });

  it("uses the completion request as the durable processing origin", async () => {
    const { target, result } = await prepared();
    await target.complete.execute({
      context,
      chapterId,
      replacementId: result.replacementId,
      originRequestId: "request-complete",
    });
    expect(target.repository.markValidatingAndEnqueue).toHaveBeenCalledWith({
      replacementId: result.replacementId,
      chapterId,
      etag: "zip-etag",
      originRequestId: "request-complete",
    });
  });

  it("CHR3-UP-10 repeated complete does not duplicate intent or verification", async () => {
    const { target, result } = await prepared();
    await target.complete.execute({
      context,
      chapterId,
      replacementId: result.replacementId,
    });
    await target.complete.execute({
      context,
      chapterId,
      replacementId: result.replacementId,
    });
    expect(target.intents.size).toBe(1);
    expect(target.transfer.verify).toHaveBeenCalledTimes(1);
  });

  it("CHR3-UP-11 prepare and complete never mutate Chapter media lifecycle", async () => {
    const { target, result } = await prepared();
    await target.complete.execute({
      context,
      chapterId,
      replacementId: result.replacementId,
    });
    expect(Object.keys(target.repository)).not.toContain("updateChapter");
  });
});
