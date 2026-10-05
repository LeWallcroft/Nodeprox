import type {
  ChapterDeletionQueuePort,
  ChapterReplacementQueuePort,
  ProcessingQueuePort,
  AdmissionValidationQueuePort,
} from "@nodeprox/types";
import type { ChapterReplacementProcessingOutboxPort } from "../../../chapter-replacements/application/ports/chapter-replacement-upload.repository.js";
import type { ChapterDeletionOutboxPort } from "../../../chapters/application/ports/chapter-deletion-outbox.ports.js";
import type { ProcessingOutboxPort } from "../../application/ports.js";

type AdmissionOutbox = {
  findPending(limit: number): Promise<
    {
      outboxId: string;
      uploadId: string | null;
      replacementId: string | null;
      originRequestId: string | null;
    }[]
  >;
  markEnqueued(outboxId: string): Promise<void>;
};

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
    private readonly admissions?: AdmissionOutbox,
    private readonly logger?: { error(context: object, message: string): void },
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
        } catch (error) {
          this.logger?.error(
            {
              event: "processing-outbox-dispatch-failed",
              outboxId: entry.id,
              errorName: error instanceof Error ? error.name : "unknown",
            },
            "Processing outbox dispatch failed",
          );
        }
      }
      const deletions = await this.deletions?.findPending(20);
      for (const deletion of deletions ?? []) {
        try {
          if (!this.queue.enqueueChapterDeletion)
            throw new Error("chapter-deletion-queue-unavailable");
          await this.queue.enqueueChapterDeletion(deletion);
          await this.deletions?.markEnqueued(deletion.deletionId);
        } catch (error) {
          this.logger?.error(
            {
              event: "deletion-outbox-dispatch-failed",
              deletionId: deletion.deletionId,
              errorName: error instanceof Error ? error.name : "unknown",
            },
            "Deletion outbox dispatch failed",
          );
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
            outboxId: replacement.id,
            replacementId: replacement.replacementId,
            chapterId: replacement.chapterId,
            ...(replacement.originRequestId
              ? { originRequestId: replacement.originRequestId }
              : {}),
          });
          await this.replacements?.markEnqueued(replacement.id);
        } catch (error) {
          this.logger?.error(
            {
              event: "replacement-outbox-dispatch-failed",
              replacementId: replacement.replacementId,
              errorName: error instanceof Error ? error.name : "unknown",
            },
            "Replacement outbox dispatch failed",
          );
        }
      }
      const admissions = await this.admissions?.findPending(20);
      for (const admission of admissions ?? []) {
        try {
          const admissionQueue = this.queue as ProcessingQueuePort &
            AdmissionValidationQueuePort;
          await admissionQueue.enqueueAdmissionValidation({
            outboxId: admission.outboxId,
            ...(admission.uploadId ? { uploadId: admission.uploadId } : {}),
            ...(admission.replacementId
              ? { replacementId: admission.replacementId }
              : {}),
            ...(admission.originRequestId
              ? { originRequestId: admission.originRequestId }
              : {}),
          });
          await this.admissions?.markEnqueued(admission.outboxId);
        } catch (error) {
          this.logger?.error(
            {
              event: "admission-outbox-dispatch-failed",
              outboxId: admission.outboxId,
              errorName: error instanceof Error ? error.name : "unknown",
            },
            "Admission outbox dispatch failed",
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (this.timer) return;
    const dispatch = () => {
      void this.dispatchOnce().catch((error) => {
        this.logger?.error(
          {
            event: "outbox-dispatch-cycle-failed",
            errorName: error instanceof Error ? error.name : "unknown",
          },
          "Outbox dispatch cycle failed",
        );
      });
    };
    dispatch();
    this.timer = setInterval(dispatch, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
