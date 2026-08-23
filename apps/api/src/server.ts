import {
  loadConfig,
  loadProcessingConfig,
  loadStorageConfig,
} from "@nodeprox/config";
import { createDatabase } from "../../../database/client.js";
import { buildApp } from "./app.js";
import { BullMQProcessingQueue } from "./modules/processing/infrastructure/queue/bullmq.processing.queue.js";
import { ProcessingOutboxDispatcher } from "./modules/processing/infrastructure/outbox/processing-outbox.dispatcher.js";
import { DrizzleUploadRepository } from "./modules/uploads/infrastructure/persistence/drizzle/upload.repository.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const processing = loadProcessingConfig();
const queue = new BullMQProcessingQueue(
  config.REDIS_URL,
  processing.PROCESSING_QUEUE_NAME,
);
const dispatcher = new ProcessingOutboxDispatcher(
  new DrizzleUploadRepository(database.db),
  queue,
);
const app = buildApp(
  { logger: { level: config.LOG_LEVEL } },
  {
    database: database.db,
    secureCookie: config.NODE_ENV === "production",
    storage: loadStorageConfig(),
  },
);
dispatcher.start();

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
