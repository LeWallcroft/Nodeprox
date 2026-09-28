import { randomUUID } from "node:crypto";
import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import {
  type ApiDependencies,
  type AppDependencies,
  createApiDependencies,
} from "./composition/create-api-dependencies.js";
import { registerAccountPlugin } from "./modules/authentication/presentation/account.plugin.js";
import { registerAuthentication } from "./modules/authentication/presentation/authentication.plugin.js";
import { requireSession } from "./modules/authentication/presentation/session-guards.js";
import { registerAuditPlugin } from "./modules/authorization/presentation/audit.plugin.js";
import { registerAuthorization } from "./modules/authorization/presentation/authorization.plugin.js";
import { registerSettingsPlugin } from "./modules/authorization/presentation/settings.plugin.js";
import { registerChapterReplacementPlugin } from "./modules/chapter-replacements/presentation/chapter-replacement.plugin.js";
import { registerChapterPermissionPlugin } from "./modules/chapters/presentation/chapter-permission.plugin.js";
import { registerDiscordPlugin } from "./modules/discord/presentation/discord.plugin.js";
import { registerDiscordAdminPlugin } from "./modules/discord/presentation/discord-admin.plugin.js";
import { registerSeriesGrantAdminPlugin } from "./modules/discord/presentation/series-grant-admin.plugin.js";
import { registerHealthController } from "./modules/health/health.controller.js";
import { HealthRepository } from "./modules/health/health.repository.js";
import { HealthService } from "./modules/health/health.service.js";
import { registerIdentityPlugin } from "./modules/identity/presentation/identity.plugin.js";
import { registerImagePlugin } from "./modules/images/presentation/image.plugin.js";
import { registerImportBatchPlugin } from "./modules/ingestion/presentation/import-batch.plugin.js";
import { registerNotificationPlugin } from "./modules/notifications/presentation/notification.plugin.js";
import { registerOverviewPlugin } from "./modules/overview/presentation/overview.plugin.js";
import { registerPublicationPlugin } from "./modules/publication/presentation/publication.plugin.js";
import { registerSeriesPlugin } from "./modules/series/presentation/series.plugin.js";
import { registerStorageProfilePlugin } from "./modules/storage-profiles/presentation/storage-profile.plugin.js";
import { registerUploadPlugin } from "./modules/uploads/presentation/upload.plugin.js";
import { registerUploadCenterPlugin } from "./modules/uploads/presentation/upload-center.plugin.js";
import { API_LOGGER_OPTIONS } from "./observability/logger.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerRequestContext } from "./plugins/request-context.js";

export type { AppDependencies } from "./composition/create-api-dependencies.js";

export function buildApp(
  options: FastifyServerOptions = {},
  dependencies: AppDependencies | ApiDependencies = {},
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
  const app = Fastify({ ...options, logger, genReqId: () => randomUUID() });
  const services =
    "createSeriesGrantServices" in dependencies
      ? dependencies
      : createApiDependencies(dependencies);

  registerRequestContext(app, services.database);
  registerErrorHandler(app, services.operationAuditWriter);
  registerHealthController(app, new HealthService(new HealthRepository()));
  if (services.database) {
    const database = services.database;
    const storageExecution = services.storageExecution;
    const activeStorageProfile = services.activeStorageProfile;
    if (!storageExecution || !activeStorageProfile)
      throw new Error("api-storage-profile-runtime-required");
    const authentication = registerAuthentication(
      app,
      database,
      services.secureCookie,
    );
    registerAccountPlugin(app, {
      db: database,
      authentication,
      email: services.email,
      ...services.account,
    });
    const authorization = registerAuthorization(app, database, authentication);
    registerSeriesGrantAdminPlugin(app, {
      ...services.createSeriesGrantServices(authorization),
      authentication,
    });
    const discord = services.createDiscordServices(authorization, app.log);
    if (discord) {
      registerDiscordPlugin(app, {
        service: discord.service,
        internalToken: services.discord?.internalToken,
        authentication,
        authorization,
      });
      if (discord.admin)
        registerDiscordAdminPlugin(app, {
          service: discord.admin,
          authentication,
        });
    }
    registerIdentityPlugin(app, database, authentication, authorization);
    if (!services.notificationRepository)
      throw new Error("api-notification-repository-required");
    registerNotificationPlugin(app, {
      repository: services.notificationRepository,
      authentication,
    });
    registerAuditPlugin(app, database, authentication, authorization);
    registerSettingsPlugin(app, database, authentication, authorization);
    registerStorageProfilePlugin(
      app,
      database,
      authentication,
      authorization,
      services.storageProfileConfig,
      services.storageProfileControl,
    );
    registerOverviewPlugin(app, database, authentication, authorization);
    const chapterPermissions = registerChapterPermissionPlugin(
      app,
      database,
      authentication,
      authorization,
    );
    const seriesRuntime = registerSeriesPlugin(
      app,
      database,
      authentication,
      authorization,
      chapterPermissions,
      services.domainEvents,
      services.seriesChannelGateway,
    );
    const sessionGuard = requireSession(
      authentication.service,
      authentication.cookies,
    );
    registerChapterReplacementPlugin(app, {
      ...services.createChapterReplacementServices(chapterPermissions),
      sessionGuard,
    });
    const uploadService = registerUploadPlugin(
      app,
      database,
      authentication,
      chapterPermissions,
      services.storageConfig,
      storageExecution,
      activeStorageProfile,
    );
    registerUploadCenterPlugin(app, {
      service: services.createUploadCenterService(),
      sessionGuard,
    });
    registerImportBatchPlugin(
      app,
      database,
      authentication,
      seriesRuntime.seriesService,
      uploadService,
      services.storageConfig.uploadMaxSizeBytes,
    );
    const images = services.createImageServices(chapterPermissions);
    registerImagePlugin(app, {
      imageQueryService: images.query,
      replacementPreparation: {
        service: images.prepare,
        storageExecution,
      },
      replacementCompletion: { service: images.complete },
      sessionGuard,
    });
    registerPublicationPlugin(app, services.createPublicationService());
  }
  return app;
}
