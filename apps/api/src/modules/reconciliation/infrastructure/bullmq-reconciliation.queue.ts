import { Queue } from "bullmq";
import type {
  QueueIntent,
  ReconciliationQueuePort,
} from "../application/integrity-reconciliation.service.js";

export class BullMQReconciliationQueue implements ReconciliationQueuePort {
  private readonly queue: Queue;

  constructor(redisUrl: string, queueName: string) {
    const url = new URL(redisUrl);
    this.queue = new Queue(queueName, {
      connection: {
        host: url.hostname,
        port: Number(url.port || 6379),
        ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
      },
    });
  }

  async state(
    jobId: string,
  ): Promise<"missing" | "waiting" | "active" | "completed" | "failed"> {
    const job = await this.queue.getJob(jobId);
    if (!job) return "missing";
    const state = await job.getState();
    if (state === "completed") return "completed";
    if (state === "failed") return "failed";
    if (state === "active") return "active";
    return "waiting";
  }

  async enqueue(intent: QueueIntent): Promise<void> {
    const name =
      intent.kind === "processing"
        ? "chapter.process"
        : intent.kind === "deletion"
          ? "chapter.delete"
          : "chapter.replacement.process";
    await this.queue.add(name, intent.payload, {
      jobId: intent.jobId,
      attempts: 3,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: 100,
      removeOnFail: 100,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
