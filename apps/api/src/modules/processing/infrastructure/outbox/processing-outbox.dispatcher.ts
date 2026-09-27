import type {
  ChapterDeletionQueuePort,
  ChapterReplacementQueuePort,
  ProcessingQueuePort,
} from "@nodeprox/types";
import type { ChapterReplacementProcessingOutboxPort } from "../../../chapter-replacements/application/ports/chapter-replacement-upload.repository.js";
import type { ChapterDeletionOutboxPort } from "../../../chapters/application/ports/chapter-deletion-outbox.ports.js";
import type { ProcessingOutboxPort } from "../../application/ports.js";

export class ProcessingOutboxDispatcher {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly outbox: ProcessingOutboxPort,
    private readonly queue: ProcessingQueuePort &
      Partial<ChapterDeletionQueuePort>,
    private readonly deletions?: ChapterDeletionOutboxPort,
    private readonly intervalMs = 1000,
    private readonly replacements?: ChapterReplacementProcessingOutboxPort,
  ) {}

  async dispatchOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const entries = await this.outbox.findPending(20);
      for (const entry of entries) {
        try {
          await this.queue.enqueueChapterProcessing(entry);
          await this.outbox.markEnqueued(entry.id);
        } catch {
          // The outbox remains pending and will be retried on the next poll.
        }
      }
      const deletions = await this.deletions?.findPending(20);
      for (const deletion of deletions ?? []) {
        try {
          if (!this.queue.enqueueChapterDeletion)
            throw new Error("chapter-deletion-queue-unavailable");
          await this.queue.enqueueChapterDeletion(deletion);
          await this.deletions?.markEnqueued(deletion.deletionId);
        } catch {
          // The durable request remains pending and is dispatched again.
        }
      }
      const replacements = await this.replacements?.findPending(20);
      for (const replacement of replacements ?? []) {
        try {
          const replacementQueue = this.queue as ProcessingQueuePort &
            Partial<ChapterReplacementQueuePort>;
          if (!replacementQueue.enqueueChapterReplacement)
            throw new Error("chapter-replacement-queue-unavailable");
          await replacementQueue.enqueueChapterReplacement({
            replacementId: replacement.replacementId,
            chapterId: replacement.chapterId,
            ...(replacement.originRequestId
              ? { originRequestId: replacement.originRequestId }
              : {}),
          });
          await this.replacements?.markEnqueued(replacement.id);
        } catch {
          // The durable replacement intent remains pending for a later dispatch.
        }
      }
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    void this.dispatchOnce();
    this.timer = setInterval(() => void this.dispatchOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
