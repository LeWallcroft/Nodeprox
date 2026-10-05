import { describe, expect, it, vi } from "vitest";
import type { ChapterReplacementProcessingOutboxPort } from "../../apps/api/src/modules/chapter-replacements/application/ports/chapter-replacement-upload.repository.js";
import type { ProcessingOutboxPort } from "../../apps/api/src/modules/processing/application/ports.js";
import { ProcessingOutboxDispatcher } from "../../apps/api/src/modules/processing/infrastructure/outbox/processing-outbox.dispatcher.js";
import { replacementProcessingJobId } from "../../apps/api/src/modules/processing/infrastructure/queue/bullmq.processing.queue.js";
import type {
  ChapterReplacementQueuePort,
  ProcessingQueuePort,
} from "@nodeprox/types";

const initialOutbox: ProcessingOutboxPort = {
  findPending: vi.fn().mockResolvedValue([]),
  markEnqueued: vi.fn(),
};

function harness(queueFails = false, originRequestId?: string) {
  const replacements: ChapterReplacementProcessingOutboxPort = {
    findPending: vi.fn().mockResolvedValue([
      {
        id: "intent",
        replacementId: "replacement",
        chapterId: "chapter",
        ...(originRequestId ? { originRequestId } : {}),
      },
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
      outboxId: "intent",
    });
    expect(target.replacements.markEnqueued).toHaveBeenCalledWith("intent");
  });

  it("keeps durable intent pending when queue dispatch fails", async () => {
    const target = harness(true);
    await target.dispatcher.dispatchOnce();
    expect(target.replacements.markEnqueued).not.toHaveBeenCalled();
  });

  it("preserves the HTTP origin without changing replacement job identity", async () => {
    const target = harness(false, "request-complete");
    await target.dispatcher.dispatchOnce();
    expect(target.queue.enqueueChapterReplacement).toHaveBeenCalledWith({
      replacementId: "replacement",
      chapterId: "chapter",
      outboxId: "intent",
      originRequestId: "request-complete",
    });
    expect(replacementProcessingJobId({ replacementId: "replacement" })).toBe(
      "chapter-replacement-replacement-initial",
    );
  });

  it("derives deterministic BullMQ job identity from each durable outbox request", () => {
    expect(replacementProcessingJobId({ replacementId: "replacement" })).toBe(
      "chapter-replacement-replacement-initial",
    );
    expect(
      replacementProcessingJobId({
        replacementId: "replacement",
        outboxId: "retry-2",
      }),
    ).not.toBe(
      replacementProcessingJobId({
        replacementId: "replacement",
        outboxId: "intent",
      }),
    );
  });
});
