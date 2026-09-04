import { describe, expect, it, vi } from "vitest";
import type { ChapterReplacementProcessingOutboxPort } from "../../apps/api/src/modules/chapter-replacements/application/ports/chapter-replacement-upload.repository.js";
import type { ProcessingOutboxPort } from "../../apps/api/src/modules/processing/application/ports.js";
import { ProcessingOutboxDispatcher } from "../../apps/api/src/modules/processing/infrastructure/outbox/processing-outbox.dispatcher.js";
import { replacementProcessingJobId } from "../../apps/api/src/modules/processing/infrastructure/queue/bullmq.processing.queue.js";
import type {
  ChapterReplacementQueuePort,
  ProcessingQueuePort,
} from "../../packages/types/src/index.js";

const initialOutbox: ProcessingOutboxPort = {
  findPending: vi.fn().mockResolvedValue([]),
  markEnqueued: vi.fn(),
};

function harness(queueFails = false) {
  const replacements: ChapterReplacementProcessingOutboxPort = {
    findPending: vi
      .fn()
      .mockResolvedValue([
        { id: "intent", replacementId: "replacement", chapterId: "chapter" },
      ]),
    markEnqueued: vi.fn(),
  };
  const queue: ProcessingQueuePort & ChapterReplacementQueuePort = {
    enqueueChapterProcessing: vi.fn(),
    enqueueChapterReplacement: queueFails
      ? vi.fn().mockRejectedValue(new Error("redis-down"))
      : vi.fn(),
  };
  const dispatcher = new ProcessingOutboxDispatcher(
    initialOutbox,
    queue,
    undefined,
    1000,
    replacements,
  );
  return { replacements, queue, dispatcher };
}

describe("CHR3 replacement processing outbox", () => {
  it("dispatches a stable-identifier-only replacement payload", async () => {
    const target = harness();
    await target.dispatcher.dispatchOnce();
    expect(target.queue.enqueueChapterReplacement).toHaveBeenCalledWith({
      replacementId: "replacement",
      chapterId: "chapter",
    });
    expect(target.replacements.markEnqueued).toHaveBeenCalledWith("intent");
  });

  it("keeps durable intent pending when queue dispatch fails", async () => {
    const target = harness(true);
    await target.dispatcher.dispatchOnce();
    expect(target.replacements.markEnqueued).not.toHaveBeenCalled();
  });

  it("derives deterministic BullMQ job identity from replacementId", () => {
    expect(replacementProcessingJobId({ replacementId: "replacement" })).toBe(
      "chapter-replacement-replacement",
    );
  });
});
