import { Worker, type Job, type WorkerOptions } from "bullmq";
import type { WorkerDependencies } from "./create-worker-dependencies.js";
import { createWorkerJobHandler } from "./worker-job-handler.js";

type WorkerHandle = Pick<Worker, "on" | "close">;
type WorkerFactory = (
  name: string,
  handler: (job: Job) => Promise<void>,
  options: WorkerOptions,
) => WorkerHandle;

type RuntimeDependencies = Pick<
  WorkerDependencies,
  | "config"
  | "processing"
  | "database"
  | "storageConfig"
  | "logger"
  | "mediaEffects"
  | "storageCleanup"
  | "deletion"
  | "loadImageProcessingWarnings"
  | "createExtractor"
  | "createChapterProcessing"
  | "createReplacementProcessing"
>;

export function createWorkerRuntime(
  dependencies: RuntimeDependencies,
  workerFactory: WorkerFactory = (name, handler, options) =>
    new Worker(name, handler, options),
) {
  const redis = new URL(dependencies.config.REDIS_URL);
  const worker = workerFactory(
    dependencies.processing.PROCESSING_QUEUE_NAME,
    createWorkerJobHandler(dependencies),
    {
      connection: {
        host: redis.hostname,
        port: Number(redis.port || 6379),
        ...(redis.password
          ? { password: decodeURIComponent(redis.password) }
          : {}),
      },
      concurrency: 1,
    },
  );
  worker.on("failed", (job, error) => {
    dependencies.logger.error(
      {
        event: "worker-job-failed",
        jobName: job?.name ?? "unknown",
        jobId: job?.id ?? "unknown",
        attemptsMade: job?.attemptsMade ?? 0,
        originRequestId: job?.data.originRequestId,
        chapterId: job?.data.chapterId,
        uploadId: job?.data.uploadId,
        replacementId: job?.data.replacementId,
        errorName: error.name,
        errorMessage: sanitizeDiagnosticText(error.message, dependencies),
      },
      "Worker job failed",
    );
  });

  let started = false;
  let stopping: Promise<void> | undefined;
  return {
    start() {
      if (started || stopping) return;
      started = true;
      dependencies.mediaEffects?.start();
      dependencies.storageCleanup.start();
    },
    stop(): Promise<void> {
      if (stopping) return stopping;
      stopping = (async () => {
        dependencies.mediaEffects?.stop();
        dependencies.storageCleanup.stop();
        try {
          await worker.close();
        } finally {
          await dependencies.database.sql.end();
        }
      })();
      return stopping;
    },
  };
}

function sanitizeDiagnosticText(
  value: string,
  dependencies: Pick<WorkerDependencies, "config" | "storageConfig">,
): string {
  let sanitized = value;
  const secrets = [
    dependencies.config.DATABASE_URL,
    dependencies.config.REDIS_URL,
    ...(dependencies.storageConfig.provider === "b2"
      ? [
          dependencies.storageConfig.b2.B2_KEY_ID,
          dependencies.storageConfig.b2.B2_APPLICATION_KEY,
        ]
      : []),
  ];
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, "[REDACTED]");
  }
  return sanitized
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/(?:postgres(?:ql)?|redis):\/\/\S+/gi, "[REDACTED_URL]")
    .replace(
      /\b(authorization|cookie|password|secret|token|x-amz-signature|x-amz-credential)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED_AWS_KEY]");
}
