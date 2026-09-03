import "dotenv/config";
import { join } from "node:path";
import { Worker } from "bullmq";
import pino from "pino";
import {
  loadConfig,
  loadMediaEffectsConfig,
  loadProcessingConfig,
  loadStorageConfig,
} from "@nodeprox/config";
import { B2Storage, FilesystemStorage } from "@nodeprox/storage/adapters";
import { createDatabase } from "../../../database/client.js";
import { systemConfig } from "../../../database/schema/index.js";
import { inArray } from "drizzle-orm";
import { ChapterProcessingService } from "./processing/application/chapter-processing.service.js";
import { UnzipperExtractor } from "./processing/infrastructure/zip/unzipper.extractor.js";
import { DrizzleProcessingRepository } from "./processing/infrastructure/persistence/drizzle/processing.repository.js";
import { ChapterDeletionService } from "./deletion/application/chapter-deletion.service.js";
import { DrizzleChapterDeletionRepository } from "./deletion/infrastructure/persistence/drizzle/chapter-deletion.repository.js";
import { MediaEffectProcessor } from "./media-effects/application/media-effect.processor.js";
import { CloudflareCdnInvalidationAdapter } from "./media-effects/infrastructure/cloudflare-cdn-invalidation.adapter.js";
import { DrizzleMediaEffectRepository } from "./media-effects/infrastructure/persistence/drizzle/media-effect.repository.js";
const config = loadConfig();
const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      "password",
      "passwordHash",
      "token",
      "accessToken",
      "refreshToken",
      "authorization",
      "cookie",
      "DATABASE_URL",
      "REDIS_URL",
      "presignedUrl",
      "CLOUDFLARE_PURGE_API_TOKEN",
    ],
    censor: "[REDACTED]",
  },
});
const processing = loadProcessingConfig();
const database = createDatabase(config.DATABASE_URL);
const storageConfig = loadStorageConfig();
const storage =
  storageConfig.provider === "b2"
    ? new B2Storage(storageConfig.b2)
    : new FilesystemStorage(join(process.cwd(), ".nodeprox-storage"));
const mediaEffectsConfig = loadMediaEffectsConfig();
const mediaEffects = mediaEffectsConfig
  ? new MediaEffectProcessor(
      new DrizzleMediaEffectRepository(database.db),
      new CloudflareCdnInvalidationAdapter(
        mediaEffectsConfig.CLOUDFLARE_ZONE_ID,
        mediaEffectsConfig.CLOUDFLARE_PURGE_API_TOKEN,
      ),
      storage,
      logger,
    )
  : null;
mediaEffects?.start();
const repository = new DrizzleProcessingRepository(database.db);
const deletion = new ChapterDeletionService(
  new DrizzleChapterDeletionRepository(database.db),
  storage,
);
const redisUrl = new URL(config.REDIS_URL);
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.password
    ? { password: decodeURIComponent(redisUrl.password) }
    : {}),
};
const worker = new Worker(
  processing.PROCESSING_QUEUE_NAME,
  async (job) => {
    const correlation = {
      jobId: String(job.id),
      attemptsMade: job.attemptsMade,
      originRequestId: job.data.originRequestId,
      chapterId: job.data.chapterId,
      uploadId: "uploadId" in job.data ? job.data.uploadId : undefined,
    };
    logger.info(correlation, "Worker job started");
    if (job.name === "chapter.delete") {
      await deletion.execute(job.data);
      logger.info(correlation, "Worker job completed");
      return;
    }
    const warningRows = await database.db
      .select({ key: systemConfig.key, value: systemConfig.value })
      .from(systemConfig)
      .where(
        inArray(systemConfig.key, [
          "upload_warning_image_size_mb",
          "upload_warning_width_px",
          "upload_warning_height_px",
        ]),
      );
    const warnings = new Map(
      warningRows.flatMap((row) =>
        typeof row.value === "number" ? [[row.key, row.value] as const] : [],
      ),
    );
    const extractor = new UnzipperExtractor({
      maxEntries: processing.PROCESSING_MAX_ENTRIES,
      maxTotalBytes: processing.PROCESSING_MAX_TOTAL_SIZE_BYTES,
      maxImageBytes: processing.PROCESSING_MAX_IMAGE_SIZE_BYTES,
      warnImageBytes:
        (warnings.get("upload_warning_image_size_mb") ?? 8) * 1024 * 1024,
      warnWidthPx: warnings.get("upload_warning_width_px") ?? 4000,
      warnHeightPx: warnings.get("upload_warning_height_px") ?? 12000,
    });
    const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
    await new ChapterProcessingService(
      repository,
      storage,
      extractor,
      repository,
    ).process(job.data, finalAttempt);
    logger.info(correlation, "Worker job completed");
  },
  { connection, concurrency: 1 },
);

function sanitizeDiagnosticText(value: string): string {
  let sanitized = value;
  const secrets = [
    config.DATABASE_URL,
    config.REDIS_URL,
    ...(storageConfig.provider === "b2"
      ? [storageConfig.b2.B2_KEY_ID, storageConfig.b2.B2_APPLICATION_KEY]
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

worker.on("failed", (job, error) => {
  logger.error(
    {
      event: "worker-job-failed",
      jobName: job?.name ?? "unknown",
      jobId: job?.id ?? "unknown",
      attemptsMade: job?.attemptsMade ?? 0,
      originRequestId: job?.data.originRequestId,
      chapterId: job?.data.chapterId,
      uploadId: job?.data.uploadId,
      errorName: error.name,
      errorMessage: sanitizeDiagnosticText(error.message),
    },
    "Worker job failed",
  );
});
process.once("SIGTERM", async () => {
  mediaEffects?.stop();
  await worker.close();
  await database.sql.end();
});
process.once("SIGINT", async () => {
  mediaEffects?.stop();
  await worker.close();
  await database.sql.end();
});
