import type { NodeProxConfig } from "@nodeprox/config";
import type { FastifyBaseLogger } from "fastify";
import { ChapterMediaActivationService } from "../modules/chapter-replacements/application/chapter-media-activation.service.js";
import { ChapterReplacementReadyHandler } from "../modules/chapter-replacements/application/chapter-replacement-ready.handler.js";
import { DrizzleChapterMediaReplacementRepository } from "../modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-media-replacement.repository.js";
import { DrizzleChapterReplacementRepository } from "../modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement.repository.js";
import { DrizzleChapterReplacementProcessingRepository } from "../modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import { DrizzleChapterDeletionOutboxRepository } from "../modules/chapters/infrastructure/persistence/drizzle/chapter-deletion-outbox.repository.js";
import { DomainEventDispatcher } from "../modules/events/application/domain-event-dispatcher.js";
import { DefaultDomainEventHandlerRegistry } from "../modules/events/application/domain-event-handler.js";
import { DomainEventDispatcherRuntime } from "../modules/events/infrastructure/domain-event-dispatcher.runtime.js";
import { DrizzleDomainEventOutboxRepository } from "../modules/events/infrastructure/persistence/drizzle-domain-event-outbox.repository.js";
import { ActivateImageCandidateService } from "../modules/images/application/services/activate-image-candidate.service.js";
import { ImageReplacementReadyHandler } from "../modules/images/application/services/image-replacement-ready.handler.js";
import { DrizzleImageReplacementOperationRepository } from "../modules/images/infrastructure/persistence/drizzle/image-replacement-operation.repository.js";
import { DrizzleMediaReplacementRepository } from "../modules/images/infrastructure/persistence/drizzle/media-replacement.repository.js";
import { NotificationProjector } from "../modules/notifications/application/notification-projector.js";
import { DrizzleNotificationRepository } from "../modules/notifications/infrastructure/persistence/drizzle-notification.repository.js";
import { ProcessingOutboxDispatcher } from "../modules/processing/infrastructure/outbox/processing-outbox.dispatcher.js";
import { BullMQProcessingQueue } from "../modules/processing/infrastructure/queue/bullmq.processing.queue.js";
import { DrizzleUploadRepository } from "../modules/uploads/infrastructure/persistence/drizzle/upload.repository.js";
import { DrizzleAdmissionOutboxRepository } from "../modules/uploads/infrastructure/persistence/drizzle/admission-outbox.repository.js";
import type { ApiDependencies } from "./create-api-dependencies.js";

type ProcessingConfig = ReturnType<
  typeof import("@nodeprox/config").loadProcessingConfig
>;
type DomainEventsConfig = ReturnType<
  typeof import("@nodeprox/config").loadDomainEventDispatchConfig
>;

export function createApiRuntime(input: {
  dependencies: ApiDependencies;
  config: NodeProxConfig;
  processing: ProcessingConfig;
  domainEvents: DomainEventsConfig;
  logger: FastifyBaseLogger;
}) {
  const { dependencies, config, processing, domainEvents, logger } = input;
  const database = dependencies.database;
  if (!database) throw new Error("api-database-required");
  const storageExecution = dependencies.storageExecution;
  if (!storageExecution)
    throw new Error("api-storage-profile-runtime-required");
  const queue = new BullMQProcessingQueue(
    config.REDIS_URL,
    processing.PROCESSING_QUEUE_NAME,
  );
  const processingDispatcher = new ProcessingOutboxDispatcher(
    new DrizzleUploadRepository(database),
    queue,
    new DrizzleChapterDeletionOutboxRepository(database),
    1000,
    new DrizzleChapterReplacementProcessingRepository(database),
    new DrizzleAdmissionOutboxRepository(database),
    logger,
  );
  const eventDispatcher = new DomainEventDispatcher(
    new DrizzleDomainEventOutboxRepository(database),
    new DefaultDomainEventHandlerRegistry([
      new NotificationProjector(new DrizzleNotificationRepository(database)),
      new ChapterReplacementReadyHandler(
        new ChapterMediaActivationService(
          new DrizzleChapterReplacementRepository(database),
          new DrizzleChapterMediaReplacementRepository(
            database,
            dependencies.publicMediaOriginResolver,
          ),
        ),
      ),
      new ImageReplacementReadyHandler(
        new DrizzleImageReplacementOperationRepository(database),
        storageExecution,
        new ActivateImageCandidateService(
          new DrizzleMediaReplacementRepository(database),
          dependencies.publicMediaOriginResolver,
        ),
      ),
    ]),
    logger,
    {
      batchSize: domainEvents.DOMAIN_EVENT_DISPATCH_BATCH_SIZE,
      leaseDurationMs: domainEvents.DOMAIN_EVENT_DISPATCH_LEASE_MS,
      retryBaseDelayMs: domainEvents.DOMAIN_EVENT_DISPATCH_RETRY_BASE_MS,
      retryMaxDelayMs: domainEvents.DOMAIN_EVENT_DISPATCH_RETRY_MAX_MS,
      noHandlerDelayMs: domainEvents.DOMAIN_EVENT_DISPATCH_NO_HANDLER_DELAY_MS,
    },
  );
  const eventRuntime = new DomainEventDispatcherRuntime(
    eventDispatcher,
    logger,
    domainEvents.DOMAIN_EVENT_DISPATCH_POLL_INTERVAL_MS,
  );
  let started = false;
  let stopping: Promise<void> | undefined;
  return {
    start() {
      if (started || stopping) return;
      started = true;
      processingDispatcher.start();
      eventRuntime.start();
    },
    stop() {
      if (stopping) return stopping;
      stopping = (async () => {
        processingDispatcher.stop();
        await eventRuntime.stop(domainEvents.DOMAIN_EVENT_DISPATCH_LEASE_MS);
      })();
      return stopping;
    },
  };
}
