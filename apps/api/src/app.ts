import { join } from "node:path";
import type { NodeProxStorageConfig } from "@nodeprox/config";
import { DEFAULT_PUBLIC_MEDIA_ORIGIN } from "@nodeprox/config";
import { B2UploadTransfer, type UploadTransferPort } from "@nodeprox/storage";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import type { NodeProxDatabase } from "../../../database/client.js";
import { registerAuthentication } from "./modules/authentication/presentation/authentication.plugin.js";
import { requireSession } from "./modules/authentication/presentation/session-guards.js";
import { registerAuditPlugin } from "./modules/authorization/presentation/audit.plugin.js";
import { registerAuthorization } from "./modules/authorization/presentation/authorization.plugin.js";
import { registerSettingsPlugin } from "./modules/authorization/presentation/settings.plugin.js";
import { ChapterMediaActivationService } from "./modules/chapter-replacements/application/chapter-media-activation.service.js";
import { CompleteChapterReplacementUploadService } from "./modules/chapter-replacements/application/complete-chapter-replacement-upload.service.js";
import { FinalizeChapterReplacementService } from "./modules/chapter-replacements/application/finalize-chapter-replacement.service.js";
import { PrepareChapterReplacementService } from "./modules/chapter-replacements/application/prepare-chapter-replacement.service.js";
import { DrizzleChapterMediaReplacementRepository } from "./modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-media-replacement.repository.js";
import { DrizzleChapterReplacementRepository } from "./modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement.repository.js";
import { DrizzleChapterReplacementProcessingRepository } from "./modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import { registerChapterReplacementPlugin } from "./modules/chapter-replacements/presentation/chapter-replacement.plugin.js";
import { registerChapterPermissionPlugin } from "./modules/chapters/presentation/chapter-permission.plugin.js";
import { DiscordGatewayService } from "./modules/discord/application/discord-gateway.service.js";
import { DiscordRoleConfigurationService } from "./modules/discord/application/discord-role-configuration.service.js";
import { ListSeriesCreationGrantsForAdministrationService } from "./modules/discord/application/list-series-creation-grants-for-administration.service.js";
import { DiscordBotGuildRoleVerifier } from "./modules/discord/infrastructure/discord-bot-guild-role-verifier.js";
import { DiscordBotSeriesChannelGateway } from "./modules/discord/infrastructure/discord-bot-series-channel-gateway.js";
import { DrizzleDiscordAuthorizedRoleConfigurationRepository } from "./modules/discord/infrastructure/persistence/drizzle/discord-authorized-role-configuration.repository.js";
import { RedisLinkCodeStore } from "./modules/discord/infrastructure/redis-link-code.store.js";
import { registerDiscordPlugin } from "./modules/discord/presentation/discord.plugin.js";
import { registerDiscordAdminPlugin } from "./modules/discord/presentation/discord-admin.plugin.js";
import { DrizzleDomainEventOutbox } from "./modules/events/infrastructure/persistence/drizzle-domain-event-outbox.js";
import { registerHealthController } from "./modules/health/health.controller.js";
import { HealthRepository } from "./modules/health/health.repository.js";
import { HealthService } from "./modules/health/health.service.js";
import { registerIdentityPlugin } from "./modules/identity/presentation/identity.plugin.js";
import { ActivateImageCandidateService } from "./modules/images/application/services/activate-image-candidate.service.js";
import { CompleteImageReplacementService } from "./modules/images/application/services/complete-image-replacement.service.js";
import { ImageQueryService } from "./modules/images/application/services/image-query.service.js";
import { PrepareImageReplacementService } from "./modules/images/application/services/prepare-image-replacement.service.js";
import { DrizzleImageRepository } from "./modules/images/infrastructure/persistence/drizzle/image.repository.js";
import { DrizzleImageReplacementOperationRepository } from "./modules/images/infrastructure/persistence/drizzle/image-replacement-operation.repository.js";
import { DrizzleImageVersionResultRepository } from "./modules/images/infrastructure/persistence/drizzle/image-version-result.repository.js";
import { DrizzleMediaReplacementRepository } from "./modules/images/infrastructure/persistence/drizzle/media-replacement.repository.js";
import { registerImagePlugin } from "./modules/images/presentation/image.plugin.js";
import { registerImportBatchPlugin } from "./modules/ingestion/presentation/import-batch.plugin.js";
import { DrizzleNotificationRepository } from "./modules/notifications/infrastructure/persistence/drizzle-notification.repository.js";
import { registerNotificationPlugin } from "./modules/notifications/presentation/notification.plugin.js";
import { registerOverviewPlugin } from "./modules/overview/presentation/overview.plugin.js";
import { GetPublishedChapter } from "./modules/publication/application/services/get-published-chapter.js";
import { DrizzlePublishedChapterRepository } from "./modules/publication/infrastructure/persistence/drizzle/published-chapter.repository.js";
import { registerPublicationPlugin } from "./modules/publication/presentation/publication.plugin.js";
import { registerSeriesPlugin } from "./modules/series/presentation/series.plugin.js";
import { B2Storage } from "./modules/uploads/infrastructure/storage/b2.storage.js";
import { FilesystemStorage } from "./modules/uploads/infrastructure/storage/filesystem.storage.js";
import { UnavailableUploadTransfer } from "./modules/uploads/infrastructure/storage/unavailable-upload-transfer.js";
import { registerUploadPlugin } from "./modules/uploads/presentation/upload.plugin.js";
import { API_LOGGER_OPTIONS } from "./observability/logger.js";
import {
  DrizzleOperationAuditWriter,
  type OperationAuditWriter,
} from "./observability/operation-audit-writer.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerRequestContext } from "./plugins/request-context.js";

export interface AppDependencies {
  database?: NodeProxDatabase;
  secureCookie?: boolean;
  storage?: NodeProxStorageConfig;
  uploadTransfer?: UploadTransferPort;
  publicMediaOrigin?: string;
  operationAuditWriter?: OperationAuditWriter;
  discord?: {
    internalToken?: string | undefined;
    botInternalUrl?: string | undefined;
    redisUrl: string;
    guildId?: string | undefined;
    controlChannelId?: string | undefined;
  };
}

export function buildApp(
  options: FastifyServerOptions = {},
  dependencies: AppDependencies = {},
): FastifyInstance {
  const configuredLogger = options.logger;
  const logger =
    configuredLogger === false
      ? false
      : {
          ...API_LOGGER_OPTIONS,
          ...(typeof configuredLogger === "object" ? configuredLogger : {}),
          redact:
            typeof configuredLogger === "object" && configuredLogger.redact
              ? configuredLogger.redact
              : API_LOGGER_OPTIONS.redact,
        };
  const app = Fastify({ ...options, logger });

  registerRequestContext(app);
  registerErrorHandler(
    app,
    dependencies.operationAuditWriter ??
      (dependencies.database
        ? new DrizzleOperationAuditWriter(dependencies.database)
        : undefined),
  );
  registerHealthController(app, new HealthService(new HealthRepository()));
  if (dependencies.database) {
    const authentication = registerAuthentication(
      app,
      dependencies.database,
      dependencies.secureCookie ?? false,
    );
    const authorization = registerAuthorization(
      app,
      dependencies.database,
      authentication,
    );
    const domainEvents = new DrizzleDomainEventOutbox();
    const seriesChannelGateway =
      dependencies.discord?.botInternalUrl && dependencies.discord.internalToken
        ? new DiscordBotSeriesChannelGateway(
            dependencies.discord.botInternalUrl,
            dependencies.discord.internalToken,
          )
        : undefined;
    if (dependencies.discord) {
      const discordService = new DiscordGatewayService(
        dependencies.database,
        new RedisLinkCodeStore(dependencies.discord.redisUrl),
        domainEvents,
        dependencies.discord.guildId && dependencies.discord.controlChannelId
          ? {
              guildId: dependencies.discord.guildId,
              controlChannelId: dependencies.discord.controlChannelId,
            }
          : undefined,
        dependencies.discord.botInternalUrl &&
          dependencies.discord.internalToken
          ? new DiscordBotGuildRoleVerifier(
              dependencies.discord.botInternalUrl,
              dependencies.discord.internalToken,
            )
          : undefined,
        seriesChannelGateway,
        (error) =>
          app.log.error(
            { err: error },
            "Discord link challenge finalize failed after durable confirmation",
          ),
      );
      registerDiscordPlugin(app, {
        service: discordService,
        grantAdministration:
          new ListSeriesCreationGrantsForAdministrationService(
            dependencies.database,
            authorization,
          ),
        internalToken: dependencies.discord.internalToken,
        authentication,
        authorization,
      });
      if (
        dependencies.discord.botInternalUrl &&
        dependencies.discord.internalToken
      )
        registerDiscordAdminPlugin(app, {
          service: new DiscordRoleConfigurationService(
            new DrizzleDiscordAuthorizedRoleConfigurationRepository(
              dependencies.database,
            ),
            authorization,
            new DiscordBotGuildRoleVerifier(
              dependencies.discord.botInternalUrl,
              dependencies.discord.internalToken,
            ),
          ),
          authentication,
        });
    }
    registerIdentityPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
    );
    registerNotificationPlugin(app, {
      repository: new DrizzleNotificationRepository(dependencies.database),
      authentication,
    });
    registerAuditPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
    );
    registerSettingsPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
    );
    registerOverviewPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
    );
    const chapterPermissions = registerChapterPermissionPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
    );
    const seriesRuntime = registerSeriesPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
      chapterPermissions,
      domainEvents,
      seriesChannelGateway,
    );
    const storageConfig = dependencies.storage ?? {
      provider: "filesystem" as const,
      uploadMaxSizeBytes: 536870912,
    };
    const uploadTransfer =
      dependencies.uploadTransfer ??
      (storageConfig.provider === "b2"
        ? new B2UploadTransfer(storageConfig.b2)
        : new UnavailableUploadTransfer());
    const chapterReplacementRepository =
      new DrizzleChapterReplacementProcessingRepository(dependencies.database);
    const chapterReplacementOperations =
      new DrizzleChapterReplacementRepository(dependencies.database);
    const chapterReplacementActivation = new ChapterMediaActivationService(
      chapterReplacementOperations,
      new DrizzleChapterMediaReplacementRepository(
        dependencies.database,
        dependencies.publicMediaOrigin ?? DEFAULT_PUBLIC_MEDIA_ORIGIN,
      ),
      chapterPermissions,
    );
    const chapterReplacementServices = {
      prepare: new PrepareChapterReplacementService(
        chapterPermissions,
        chapterReplacementRepository,
        uploadTransfer,
        storageConfig.uploadMaxSizeBytes,
      ),
      completeUpload: new CompleteChapterReplacementUploadService(
        chapterReplacementRepository,
        uploadTransfer,
        chapterPermissions,
      ),
      finalize: new FinalizeChapterReplacementService(
        chapterReplacementOperations,
        chapterReplacementActivation,
        chapterPermissions,
      ),
    };
    registerChapterReplacementPlugin(app, {
      ...chapterReplacementServices,
      sessionGuard: requireSession(
        authentication.service,
        authentication.cookies,
      ),
    });
    const uploadService = registerUploadPlugin(
      app,
      dependencies.database,
      authentication,
      chapterPermissions,
      storageConfig,
      uploadTransfer,
    );
    registerImportBatchPlugin(
      app,
      dependencies.database,
      authentication,
      seriesRuntime.seriesService,
      uploadService,
      storageConfig.uploadMaxSizeBytes,
    );
    const imageStorage =
      storageConfig.provider === "b2"
        ? new B2Storage(storageConfig.b2)
        : new FilesystemStorage(join(process.cwd(), ".nodeprox-storage"));
    const imageRepository = new DrizzleImageRepository(dependencies.database);
    const imageReplacementOperations =
      new DrizzleImageReplacementOperationRepository(dependencies.database);
    const publicMediaOrigin =
      dependencies.publicMediaOrigin ?? DEFAULT_PUBLIC_MEDIA_ORIGIN;
    const imageCandidateActivator = new ActivateImageCandidateService(
      new DrizzleMediaReplacementRepository(dependencies.database),
      publicMediaOrigin,
    );
    registerImagePlugin(app, {
      imageQueryService: new ImageQueryService(
        imageRepository,
        chapterPermissions,
        imageStorage,
      ),
      replacementPreparation: {
        service: new PrepareImageReplacementService(
          imageRepository,
          chapterPermissions,
          imageReplacementOperations,
          storageConfig.uploadMaxSizeBytes,
        ),
        transfer: uploadTransfer,
      },
      replacementCompletion: {
        service: new CompleteImageReplacementService(
          imageReplacementOperations,
          new DrizzleImageVersionResultRepository(
            dependencies.database,
            publicMediaOrigin,
          ),
          uploadTransfer,
          imageCandidateActivator,
          chapterPermissions,
        ),
      },
      sessionGuard: requireSession(
        authentication.service,
        authentication.cookies,
      ),
    });
    const publishedRepository = new DrizzlePublishedChapterRepository(
      dependencies.database,
    );
    registerPublicationPlugin(
      app,
      new GetPublishedChapter(publishedRepository, publicMediaOrigin),
    );
  }

  return app;
}
