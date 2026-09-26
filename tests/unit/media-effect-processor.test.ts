import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { MediaEffectProcessor } from "../../apps/worker/src/media-effects/application/media-effect.processor.js";
import {
  CdnInvalidationError,
  type ClaimedMediaEffect,
  type MediaEffectRepositoryPort,
} from "../../apps/worker/src/media-effects/application/ports.js";
import type { StoragePort } from "@nodeprox/storage/port";

const effect: ClaimedMediaEffect = {
  id: "11111111-1111-4111-8111-111111111111",
  effectType: "storage_delete",
  imageId: "22222222-2222-4222-8222-222222222222",
  target: "Media/raven/1/00.jpg",
  attempts: 1,
};

function repository(
  item: ClaimedMediaEffect | null,
): MediaEffectRepositoryPort {
  let delivered = false;
  return {
    claimPending: vi.fn(async () => {
      if (!item || delivered) return [];
      delivered = true;
      return [item];
    }),
    isCurrentStorageKey: vi.fn(async () => false),
    markCompleted: vi.fn(async () => undefined),
    markRetry: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
  };
}

function storage(remove = vi.fn(async () => undefined)): StoragePort {
  return {
    put: vi.fn(async (input) => ({
      key: input.key,
      sizeBytes: input.sizeBytes,
      contentType: input.contentType,
    })),
    get: vi.fn(async () => Readable.from([])),
    exists: vi.fn(async () => false),
    delete: remove,
  };
}

const logger = () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe("MediaEffectProcessor", () => {
  it("deletes only an explicitly persisted non-current key", async () => {
    const repo = repository(effect);
    const remove = vi.fn(async () => undefined);
    await new MediaEffectProcessor(
      repo,
      { purgeUrls: vi.fn(async () => undefined) },
      storage(remove),
      logger(),
    ).runOnce();
    expect(repo.isCurrentStorageKey).toHaveBeenCalledWith(
      effect.imageId,
      effect.target,
    );
    expect(remove).toHaveBeenCalledWith(effect.target);
    expect(repo.markCompleted).toHaveBeenCalledWith(effect.id);
  });

  it("never deletes a key that became current", async () => {
    const repo = repository(effect);
    vi.mocked(repo.isCurrentStorageKey).mockResolvedValue(true);
    const remove = vi.fn(async () => undefined);
    await new MediaEffectProcessor(
      repo,
      { purgeUrls: vi.fn(async () => undefined) },
      storage(remove),
      logger(),
    ).runOnce();
    expect(remove).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith(
      effect.id,
      "media-effect-target-current",
    );
  });

  it("retries transient cleanup failures with backoff", async () => {
    const repo = repository(effect);
    await new MediaEffectProcessor(
      repo,
      { purgeUrls: vi.fn(async () => undefined) },
      storage(
        vi.fn(async () => {
          throw new Error("temporary-b2-error");
        }),
      ),
      logger(),
      () => new Date("2026-09-03T00:00:00.000Z"),
    ).runOnce();
    expect(repo.markRetry).toHaveBeenCalledWith(
      effect.id,
      new Date("2026-09-03T00:00:05.000Z"),
      "storage-delete-failed",
    );
  });

  it("retries a Cloudflare 429 without losing the exact target", async () => {
    const purge = { ...effect, effectType: "cdn_purge" as const };
    const repo = repository(purge);
    const cdn = {
      purgeUrls: vi.fn(async () => {
        throw new CdnInvalidationError("cdn-rate-limited", true);
      }),
    };
    await new MediaEffectProcessor(
      repo,
      cdn,
      storage(),
      logger(),
      () => new Date("2026-09-03T00:00:00.000Z"),
    ).runOnce();
    expect(cdn.purgeUrls).toHaveBeenCalledWith([purge.target]);
    expect(repo.markRetry).toHaveBeenCalledWith(
      purge.id,
      new Date("2026-09-03T00:00:05.000Z"),
      "cdn-rate-limited",
    );
  });

  it("does not execute a completed effect twice", async () => {
    const repo = repository(effect);
    const remove = vi.fn(async () => undefined);
    const processor = new MediaEffectProcessor(
      repo,
      { purgeUrls: vi.fn(async () => undefined) },
      storage(remove),
      logger(),
    );
    await processor.runOnce();
    await processor.runOnce();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
