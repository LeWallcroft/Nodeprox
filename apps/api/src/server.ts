import {
  loadConfig,
  loadDomainEventDispatchConfig,
  loadProcessingConfig,
  loadStorageConfig,
} from "@nodeprox/config";
import { createDatabase } from "../../../database/client.js";
import { buildApp } from "./app.js";
import { DrizzleChapterReplacementProcessingRepository } from "./modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import { DrizzleChapterDeletionOutboxRepository } from "./modules/chapters/infrastructure/persistence/drizzle/chapter-deletion-outbox.repository.js";
import { DomainEventDispatcher } from "./modules/events/application/domain-event-dispatcher.js";
import { DefaultDomainEventHandlerRegistry } from "./modules/events/application/domain-event-handler.js";
import { DomainEventDispatcherRuntime } from "./modules/events/infrastructure/domain-event-dispatcher.runtime.js";
import { DrizzleDomainEventOutboxRepository } from "./modules/events/infrastructure/persistence/drizzle-domain-event-outbox.repository.js";
import { NotificationProjector } from "./modules/notifications/application/notification-projector.js";
import { DrizzleNotificationRepository } from "./modules/notifications/infrastructure/persistence/drizzle-notification.repository.js";
import { ProcessingOutboxDispatcher } from "./modules/processing/infrastructure/outbox/processing-outbox.dispatcher.js";
import { BullMQProcessingQueue } from "./modules/processing/infrastructure/queue/bullmq.processing.queue.js";
import { DrizzleUploadRepository } from "./modules/uploads/infrastructure/persistence/drizzle/upload.repository.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const processing = loadProcessingConfig();
const domainEvents = loadDomainEventDispatchConfig();
const queue = new BullMQProcessingQueue(
  config.REDIS_URL,
  processing.PROCESSING_QUEUE_NAME,
);
const dispatcher = new ProcessingOutboxDispatcher(
  new DrizzleUploadRepository(database.db),
  queue,
  new DrizzleChapterDeletionOutboxRepository(database.db),
  1000,
  new DrizzleChapterReplacementProcessingRepository(database.db),
);
const app = buildApp(
  { logger: { level: config.LOG_LEVEL } },
  {
    database: database.db,
    secureCookie: config.NODE_ENV === "production",
    storage: loadStorageConfig(),
    publicMediaOrigin: config.PUBLIC_MEDIA_ORIGIN,
    discord: {
      internalToken: config.DISCORD_BOT_INTERNAL_TOKEN,
      botInternalUrl: config.DISCORD_BOT_INTERNAL_URL,
      redisUrl: config.REDIS_URL,
      guildId: config.DISCORD_GUILD_ID,
      controlChannelId: config.DISCORD_CONTROL_CHANNEL_ID,
    },
  },
);
dispatcher.start();
const domainEventDispatcher = new DomainEventDispatcher(
  new DrizzleDomainEventOutboxRepository(database.db),
  new DefaultDomainEventHandlerRegistry([
    new NotificationProjector(new DrizzleNotificationRepository(database.db)),
  ]),
  app.log,
  {
    batchSize: domainEvents.DOMAIN_EVENT_DISPATCH_BATCH_SIZE,
    leaseDurationMs: domainEvents.DOMAIN_EVENT_DISPATCH_LEASE_MS,
    retryBaseDelayMs: domainEvents.DOMAIN_EVENT_DISPATCH_RETRY_BASE_MS,
    retryMaxDelayMs: domainEvents.DOMAIN_EVENT_DISPATCH_RETRY_MAX_MS,
    noHandlerDelayMs: domainEvents.DOMAIN_EVENT_DISPATCH_NO_HANDLER_DELAY_MS,
  },
);
const domainEventRuntime = new DomainEventDispatcherRuntime(
  domainEventDispatcher,
  app.log,
  domainEvents.DOMAIN_EVENT_DISPATCH_POLL_INTERVAL_MS,
);
domainEventRuntime.start();

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  dispatcher.stop();
  await domainEventRuntime.stop(domainEvents.DOMAIN_EVENT_DISPATCH_LEASE_MS);
  await app.close();
  await database.sql.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
