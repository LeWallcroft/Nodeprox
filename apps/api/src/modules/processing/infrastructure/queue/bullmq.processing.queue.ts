import { Queue } from "bullmq";
import type {
  ChapterDeletionQueuePort,
  DeleteChapterStorageInput,
  ProcessChapterInput,
  ProcessingQueuePort,
} from "@nodeprox/types";
export class BullMQProcessingQueue
  implements ProcessingQueuePort, ChapterDeletionQueuePort
{
  private readonly queue: Queue;
  constructor(redisUrl: string, queueName = "chapter-processing") {
    const url = new URL(redisUrl);
    this.queue = new Queue(queueName, {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      },
    });
  }
  async enqueueChapterProcessing(input: ProcessChapterInput): Promise<void> {
    await this.queue.add("chapter.process", input, {
      jobId: processingJobId(input),
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }

  async enqueueChapterDeletion(
    input: DeleteChapterStorageInput,
  ): Promise<void> {
    await this.queue.add("chapter.delete", input, {
      jobId: `chapter-deletion-${input.deletionId}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }
}

export function processingJobId(
  input: Pick<ProcessChapterInput, "chapterId" | "uploadId">,
): string {
  return `chapter-processing-${input.chapterId}-${input.uploadId}`;
}
