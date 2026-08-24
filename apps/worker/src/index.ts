import "dotenv/config";
import { join } from "node:path";
import { Worker } from "bullmq";
import {
  loadConfig,
  loadProcessingConfig,
  loadStorageConfig,
} from "@nodeprox/config";
import { B2Storage, FilesystemStorage } from "@nodeprox/storage/adapters";
import { createDatabase } from "../../../database/client.js";
import { ChapterProcessingService } from "./processing/application/chapter-processing.service.js";
import { UnzipperExtractor } from "./processing/infrastructure/zip/unzipper.extractor.js";
import { DrizzleProcessingRepository } from "./processing/infrastructure/persistence/drizzle/processing.repository.js";
const config = loadConfig();
const processing = loadProcessingConfig();
const database = createDatabase(config.DATABASE_URL);
const storageConfig = loadStorageConfig();
const storage =
  storageConfig.provider === "b2"
    ? new B2Storage(storageConfig.b2)
    : new FilesystemStorage(join(process.cwd(), ".nodeprox-storage"));
const repository = new DrizzleProcessingRepository(database.db);
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
    const extractor = new UnzipperExtractor({
      maxEntries: processing.PROCESSING_MAX_ENTRIES,
      maxTotalBytes: processing.PROCESSING_MAX_TOTAL_SIZE_BYTES,
      maxImageBytes: processing.PROCESSING_MAX_IMAGE_SIZE_BYTES,
    });
    const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts ?? 1);
    await new ChapterProcessingService(
      repository,
      storage,
      extractor,
      repository,
    ).process(job.data, finalAttempt);
  },
  { connection, concurrency: 1 },
);
worker.on("failed", (job, error) => {
  if (job)
    console.error(
      `chapter processing failed: ${job.id ?? "unknown"}`,
      error.name,
    );
});
process.once("SIGTERM", async () => {
  await worker.close();
  await database.sql.end();
});
process.once("SIGINT", async () => {
  await worker.close();
  await database.sql.end();
});
