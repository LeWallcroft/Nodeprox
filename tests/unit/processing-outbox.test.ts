import { describe, expect, it, vi } from "vitest";
import { ProcessingOutboxDispatcher } from "../../apps/api/src/modules/processing/infrastructure/outbox/processing-outbox.dispatcher.js";
import type { ProcessingOutboxPort } from "../../apps/api/src/modules/processing/application/ports.js";
import type { ProcessingQueuePort } from "@nodeprox/types";

const entry = {
  id: "outbox-1",
  chapterId: "chapter-1",
  seriesId: "series-1",
  uploadId: "upload-1",
  sourceStorageKey: "uploads/series-1/chapter-1/upload-1.zip",
};

function setup() {
  const outbox: ProcessingOutboxPort = {
    findPending: vi.fn().mockResolvedValue([entry]),
    markEnqueued: vi.fn().mockResolvedValue(undefined),
  };
  const queue: ProcessingQueuePort = {
    enqueueChapterProcessing: vi.fn().mockResolvedValue(undefined),
  };
  return { outbox, queue };
}

describe("ProcessingOutboxDispatcher", () => {
  it("enqueues pending intent and marks it only after BullMQ accepts it", async () => {
    const { outbox, queue } = setup();
    const dispatcher = new ProcessingOutboxDispatcher(outbox, queue);
    await dispatcher.dispatchOnce();
    expect(queue.enqueueChapterProcessing).toHaveBeenCalledWith(entry);
    expect(outbox.markEnqueued).toHaveBeenCalledWith("outbox-1");
  });

  it("keeps the intent pending when enqueue fails", async () => {
    const { outbox, queue } = setup();
    vi.mocked(queue.enqueueChapterProcessing).mockRejectedValueOnce(
      new Error("redis unavailable"),
    );
    const dispatcher = new ProcessingOutboxDispatcher(outbox, queue);
    await dispatcher.dispatchOnce();
    expect(outbox.markEnqueued).not.toHaveBeenCalled();
  });

  it("retains normal Chapter processing origin in the existing queue contract", async () => {
    const { outbox, queue } = setup();
    vi.mocked(outbox.findPending).mockResolvedValueOnce([
      { ...entry, originRequestId: "request-upload" },
    ]);
    await new ProcessingOutboxDispatcher(outbox, queue).dispatchOnce();
    expect(queue.enqueueChapterProcessing).toHaveBeenCalledWith({
      ...entry,
      originRequestId: "request-upload",
    });
  });
});
