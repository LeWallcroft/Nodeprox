import { createHash } from "node:crypto";
import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type {
  DeleteChapterStorageInput,
  ProcessChapterInput,
  ProcessChapterReplacementInput,
} from "@nodeprox/types";

export type ReconciliationFindingCode =
  | "missing-storage-object"
  | "orphan-storage-object"
  | "stale-outbox"
  | "missing-queue-job"
  | "stale-processing-attempt"
  | "storage-key-mismatch"
  | "cleanup-pending";
export type ReconciliationAction =
  | "none"
  | "requeue"
  | "cleanup"
  | "mark-failed"
  | "manual-review";
export type ReconciliationFinding = {
  code: ReconciliationFindingCode;
  action: ReconciliationAction;
  resourceType:
    | "chapter"
    | "processing-outbox"
    | "deletion-outbox"
    | "replacement-outbox"
    | "cleanup-outbox"
    | "candidate"
    | "source";
  chapterId?: string;
  uploadId?: string;
  processingAttemptId?: string;
  outboxId?: string;
  jobId?: string;
  originRequestId?: string;
  storageKey?: string;
  storageProfileId?: string;
  result: "detected" | "repaired" | "manual-review" | "repair-failed";
};

export type QueueIntent = {
  kind: "processing" | "deletion" | "replacement";
  id: string;
  chapterId: string;
  storageProfileId?: string;
  status: "pending" | "enqueued";
  jobId: string;
  originRequestId?: string;
  aggregateStatus: string | null;
  payload:
    | ProcessChapterInput
    | DeleteChapterStorageInput
    | ProcessChapterReplacementInput;
  updatedAt: Date;
};
export type ReadyObject = {
  id: string;
  chapterId: string;
  storageKey: string;
  storageProfileId: string;
  canonicalStorageKey: string;
};
export type CandidateObject = {
  id: string;
  chapterId: string;
  uploadId: string | null;
  attemptId: string;
  storageKey: string;
  storageProfileId: string;
  checksum: string;
  status:
    | "reserved"
    | "created"
    | "reused"
    | "published"
    | "cleanup_pending"
    | "cleaned";
  attemptStatus: string;
  originRequestId?: string;
  createdAt: Date;
};
export type AttemptWork = {
  id: string;
  chapterId: string;
  uploadId: string | null;
  jobId: string | null;
  jobAttempt: number | null;
  chapterStatus: string | null;
  sourceStorageKey: string | null;
  sourceStorageProfileId: string | null;
  status: string;
  startedAt: Date;
  originRequestId?: string;
};
export type SourceCleanup = {
  id: string;
  chapterId: string;
  uploadId: string;
  storageKey: string;
  storageProfileId: string;
  originRequestId?: string;
};
export type CleanupIntent = {
  id: string;
  chapterId: string;
  storageKey: string;
  storageProfileId: string;
  status: "pending" | "processing" | "failed";
  updatedAt: Date;
  originRequestId?: string;
};
export type ReconciliationCursor = Partial<
  Record<
    | "processingIntents"
    | "deletionIntents"
    | "replacementIntents"
    | "ready"
    | "candidates"
    | "attempts"
    | "sources"
    | "cleanupIntents",
    string
  >
>;
export type ReconciliationBatch = {
  intents: QueueIntent[];
  ready: ReadyObject[];
  candidates: CandidateObject[];
  attempts: AttemptWork[];
  sources: SourceCleanup[];
  cleanupIntents: CleanupIntent[];
  nextCursor: ReconciliationCursor;
};

export interface IntegrityRepositoryPort {
  scan(
    limit: number,
    cursor: ReconciliationCursor,
  ): Promise<ReconciliationBatch>;
  markEnqueued(intent: QueueIntent): Promise<void>;
  isPublishedObject(input: {
    storageProfileId: string;
    storageKey: string;
  }): Promise<boolean>;
  withCandidateCleanupLock(
    candidate: CandidateObject,
    cleanup: () => Promise<void>,
  ): Promise<boolean>;
  markAttemptFailed(attempt: AttemptWork, code: string): Promise<void>;
  findProcessingIntent(uploadId: string): Promise<QueueIntent | null>;
}
export interface ReconciliationQueuePort {
  state(
    jobId: string,
  ): Promise<"missing" | "waiting" | "active" | "completed" | "failed">;
  enqueue(intent: QueueIntent): Promise<void>;
}
export interface ReconciliationLogger {
  info(context: ReconciliationFinding, message: string): void;
  error(context: ReconciliationFinding, message: string): void;
}

export class IntegrityReconciliationService {
  constructor(
    private readonly repository: IntegrityRepositoryPort,
    private readonly queue: ReconciliationQueuePort,
    private readonly storageExecution: StorageExecutionResolver,
    private readonly logger: ReconciliationLogger,
    private readonly now: () => Date = () => new Date(),
    private readonly safeAgeMs = 5 * 60_000,
  ) {}

  async run(input: {
    limit: number;
    cursor?: ReconciliationCursor;
    dryRun?: boolean;
  }): Promise<{
    inspected: number;
    repaired: number;
    findings: ReconciliationFinding[];
    nextCursor: ReconciliationCursor;
  }> {
    const limit = Math.max(1, Math.min(input.limit, 100));
    const batch = await this.repository.scan(limit, input.cursor ?? {});
    const findings: ReconciliationFinding[] = [];
    const old = (date: Date) =>
      this.now().getTime() - date.getTime() >= this.safeAgeMs;
    const record = async (
      finding: ReconciliationFinding,
      repair?: () => Promise<void>,
    ) => {
      if (repair && !input.dryRun) {
        try {
          await repair();
          finding.result = "repaired";
          this.logger.info(finding, "Integrity repair completed");
        } catch {
          finding.result = "repair-failed";
          this.logger.error(finding, "Integrity repair failed");
        }
      }
      findings.push(finding);
    };

    for (const intent of batch.intents) {
      if (!old(intent.updatedAt)) continue;
      const terminal =
        intent.kind === "processing"
          ? !["uploaded", "processing"].includes(intent.aggregateStatus ?? "")
          : intent.kind === "deletion"
            ? intent.aggregateStatus !== "deleting"
            : ["ready", "completed", "failed"].includes(
                intent.aggregateStatus ?? "",
              );
      if (terminal) continue;
      const state = await this.queue.state(intent.jobId);
      const base = {
        resourceType:
          `${intent.kind}-outbox` as ReconciliationFinding["resourceType"],
        chapterId: intent.chapterId,
        outboxId: intent.id,
        jobId: intent.jobId,
        ...(intent.originRequestId
          ? { originRequestId: intent.originRequestId }
          : {}),
      };
      if (state === "missing") {
        if (
          intent.kind === "processing" &&
          !(await (
            await this.storageExecution.storageFor(
              intent.storageProfileId ?? "",
            )
          ).exists((intent.payload as ProcessChapterInput).sourceStorageKey))
        ) {
          await record({
            ...base,
            code: "missing-queue-job",
            action: "manual-review",
            result: "manual-review",
          });
          continue;
        }
        const finding: ReconciliationFinding = {
          ...base,
          code:
            intent.status === "pending" ? "stale-outbox" : "missing-queue-job",
          action: "requeue",
          result: "detected",
        };
        await record(finding, async () => {
          await this.queue.enqueue(intent);
          await this.repository.markEnqueued(intent);
        });
      } else if (intent.status === "pending") {
        await record(
          { ...base, code: "stale-outbox", action: "none", result: "detected" },
          () => this.repository.markEnqueued(intent),
        );
      } else if (state === "failed" || state === "completed") {
        await record({
          ...base,
          code: "stale-outbox",
          action: "manual-review",
          result: "manual-review",
        });
      }
    }

    for (const row of batch.ready) {
      if (row.storageKey !== row.canonicalStorageKey) {
        await record({
          code: "storage-key-mismatch",
          action: "manual-review",
          resourceType: "chapter",
          chapterId: row.chapterId,
          storageKey: row.storageKey,
          result: "manual-review",
        });
      } else if (
        !(await (
          await this.storageExecution.storageFor(row.storageProfileId)
        ).exists(row.storageKey))
      ) {
        await record({
          code: "missing-storage-object",
          action: "manual-review",
          resourceType: "chapter",
          chapterId: row.chapterId,
          storageKey: row.storageKey,
          result: "manual-review",
        });
      }
    }

    for (const candidate of batch.candidates) {
      if (
        !old(candidate.createdAt) ||
        !["reserved", "created", "cleanup_pending"].includes(candidate.status)
      )
        continue;
      if (
        !["retryable_failed", "terminal_failed"].includes(
          candidate.attemptStatus,
        )
      )
        continue;
      const base = {
        resourceType: "candidate" as const,
        chapterId: candidate.chapterId,
        ...(candidate.uploadId ? { uploadId: candidate.uploadId } : {}),
        processingAttemptId: candidate.attemptId,
        storageKey: candidate.storageKey,
        storageProfileId: candidate.storageProfileId,
        ...(candidate.originRequestId
          ? { originRequestId: candidate.originRequestId }
          : {}),
      };
      if (await this.repository.isPublishedObject(candidate)) {
        await record({
          ...base,
          code: "orphan-storage-object",
          action: "manual-review",
          result: "manual-review",
        });
        continue;
      }
      const candidateStorage = await this.storageExecution.storageFor(
        candidate.storageProfileId,
      );
      if (!(await candidateStorage.exists(candidate.storageKey))) {
        await record(
          {
            ...base,
            code: "cleanup-pending",
            action: "cleanup",
            result: "detected",
          },
          async () => {
            const cleaned = await this.repository.withCandidateCleanupLock(
              candidate,
              async () => undefined,
            );
            if (!cleaned) throw new Error("candidate-cleanup-race");
          },
        );
        continue;
      }
      const hash = createHash("sha256");
      for await (const chunk of await candidateStorage.get(
        candidate.storageKey,
      ))
        hash.update(chunk);
      if (hash.digest("hex") !== candidate.checksum) {
        await record({
          ...base,
          code: "orphan-storage-object",
          action: "manual-review",
          result: "manual-review",
        });
        continue;
      }
      await record(
        {
          ...base,
          code: "orphan-storage-object",
          action: "cleanup",
          result: "detected",
        },
        async () => {
          const cleaned = await this.repository.withCandidateCleanupLock(
            candidate,
            () => candidateStorage.delete(candidate.storageKey),
          );
          if (!cleaned) throw new Error("candidate-cleanup-race");
        },
      );
    }

    for (const attempt of batch.attempts) {
      if (!old(attempt.startedAt) || attempt.status !== "processing") continue;
      const state = attempt.jobId
        ? await this.queue.state(attempt.jobId)
        : "missing";
      if (state === "waiting" || state === "active") continue;
      const base = {
        code: "stale-processing-attempt" as const,
        resourceType: "chapter" as const,
        chapterId: attempt.chapterId,
        ...(attempt.uploadId ? { uploadId: attempt.uploadId } : {}),
        processingAttemptId: attempt.id,
        ...(attempt.jobId ? { jobId: attempt.jobId } : {}),
        ...(attempt.originRequestId
          ? { originRequestId: attempt.originRequestId }
          : {}),
      };
      if (state === "failed" && attempt.chapterStatus === "processing") {
        await record(
          { ...base, action: "mark-failed", result: "detected" },
          () =>
            this.repository.markAttemptFailed(attempt, "PROCESSING_UNKNOWN"),
        );
      } else if (
        state === "missing" &&
        attempt.chapterStatus === "processing" &&
        attempt.jobAttempt === 1 &&
        attempt.uploadId &&
        attempt.sourceStorageKey &&
        attempt.sourceStorageProfileId &&
        (await (
          await this.storageExecution.storageFor(attempt.sourceStorageProfileId)
        ).exists(attempt.sourceStorageKey))
      ) {
        const intent = await this.repository.findProcessingIntent(
          attempt.uploadId,
        );
        if (intent)
          await record(
            {
              ...base,
              ...(intent.originRequestId && !attempt.originRequestId
                ? { originRequestId: intent.originRequestId }
                : {}),
              action: "requeue",
              result: "detected",
            },
            () => this.queue.enqueue(intent),
          );
        else
          await record({
            ...base,
            action: "manual-review",
            result: "manual-review",
          });
      } else {
        await record({
          ...base,
          action: "manual-review",
          result: "manual-review",
        });
      }
    }

    for (const source of batch.sources) {
      const sourceStorage = await this.storageExecution.storageFor(
        source.storageProfileId,
      );
      if (!(await sourceStorage.exists(source.storageKey))) continue;
      await record(
        {
          code: "cleanup-pending",
          action: "cleanup",
          resourceType: "source",
          chapterId: source.chapterId,
          uploadId: source.uploadId,
          processingAttemptId: source.id,
          storageKey: source.storageKey,
          storageProfileId: source.storageProfileId,
          ...(source.originRequestId
            ? { originRequestId: source.originRequestId }
            : {}),
          result: "detected",
        },
        () => sourceStorage.delete(source.storageKey),
      );
    }
    for (const intent of batch.cleanupIntents) {
      if (!old(intent.updatedAt)) continue;
      await record({
        code: "cleanup-pending",
        action: intent.status === "failed" ? "manual-review" : "none",
        resourceType: "cleanup-outbox",
        chapterId: intent.chapterId,
        outboxId: intent.id,
        storageKey: intent.storageKey,
        storageProfileId: intent.storageProfileId,
        ...(intent.originRequestId
          ? { originRequestId: intent.originRequestId }
          : {}),
        result: intent.status === "failed" ? "manual-review" : "detected",
      });
    }
    return {
      inspected:
        batch.intents.length +
        batch.ready.length +
        batch.candidates.length +
        batch.attempts.length +
        batch.sources.length +
        batch.cleanupIntents.length,
      repaired: findings.filter((finding) => finding.result === "repaired")
        .length,
      findings,
      nextCursor: batch.nextCursor,
    };
  }
}
