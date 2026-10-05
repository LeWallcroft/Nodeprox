import { join } from "node:path";
import {
  DEFAULT_PUBLIC_MEDIA_ORIGIN,
  loadStorageProfileConfig,
  type NodeProxConfig,
  type NodeProxStorageConfig,
  type NodeProxStorageProfileConfig,
} from "@nodeprox/config";
import {
  B2Storage,
  B2UploadTransfer,
  FilesystemStorage,
  StorageClientRegistry,
  type ActiveStorageProfilePort,
  type StorageExecutionResolver,
  type ManagedStorageAdministrationResolver,
  type UploadTransferPort,
} from "@nodeprox/storage";
import type { FastifyBaseLogger } from "fastify";
import {
  createStorageProfileControl,
  type StorageProfileProviderOverrides,
} from "./create-storage-profile-control.js";
import {
  createDatabase,
  type NodeProxDatabase,
} from "../../../../database/client.js";
import { DrizzleStorageProfileRuntimeRepository } from "../../../../database/storage-profile-runtime.js";
import {
  BrevoTransactionalEmail,
  NoopTransactionalEmail,
} from "../modules/authentication/infrastructure/email/brevo-transactional-email.js";
import type { AuthorizationService } from "../modules/authorization/application/services/authorization.service.js";
import { ChapterMediaActivationService } from "../modules/chapter-replacements/application/chapter-media-activation.service.js";
import { CompleteChapterReplacementUploadService } from "../modules/chapter-replacements/application/complete-chapter-replacement-upload.service.js";
import { FinalizeChapterReplacementService } from "../modules/chapter-replacements/application/finalize-chapter-replacement.service.js";
import { PrepareChapterReplacementService } from "../modules/chapter-replacements/application/prepare-chapter-replacement.service.js";
import { DrizzleChapterMediaReplacementRepository } from "../modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-media-replacement.repository.js";
import { DrizzleChapterReplacementRepository } from "../modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement.repository.js";
import { DrizzleChapterReplacementProcessingRepository } from "../modules/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import type { ChapterPermissionService } from "../modules/chapters/application/services/chapter-permission.service.js";
import { DiscordGatewayService } from "../modules/discord/application/discord-gateway.service.js";
import { DiscordRoleConfigurationService } from "../modules/discord/application/discord-role-configuration.service.js";
import type { DiscordSeriesChannelGateway } from "../modules/discord/application/discord-series-channel-gateway.js";
import { ListSeriesCreationGrantsForAdministrationService } from "../modules/discord/application/list-series-creation-grants-for-administration.service.js";
import { WebSeriesCreationGrantService } from "../modules/discord/application/web-series-creation-grant.service.js";
import { DiscordBotGuildRoleVerifier } from "../modules/discord/infrastructure/discord-bot-guild-role-verifier.js";
import { DiscordBotSeriesChannelGateway } from "../modules/discord/infrastructure/discord-bot-series-channel-gateway.js";
import { DrizzleDiscordAuthorizedRoleConfigurationRepository } from "../modules/discord/infrastructure/persistence/drizzle/discord-authorized-role-configuration.repository.js";
import { RedisLinkCodeStore } from "../modules/discord/infrastructure/redis-link-code.store.js";
import { DrizzleDomainEventOutbox } from "../modules/events/infrastructure/persistence/drizzle-domain-event-outbox.js";
import { CompleteImageReplacementService } from "../modules/images/application/services/complete-image-replacement.service.js";
import { ImageQueryService } from "../modules/images/application/services/image-query.service.js";
import { PrepareImageReplacementService } from "../modules/images/application/services/prepare-image-replacement.service.js";
import { DrizzleImageRepository } from "../modules/images/infrastructure/persistence/drizzle/image.repository.js";
import { DrizzleImageReplacementOperationRepository } from "../modules/images/infrastructure/persistence/drizzle/image-replacement-operation.repository.js";
import { DrizzleMediaReplacementRepository } from "../modules/images/infrastructure/persistence/drizzle/media-replacement.repository.js";
import { DrizzleNotificationRepository } from "../modules/notifications/infrastructure/persistence/drizzle-notification.repository.js";
import { GetPublishedChapter } from "../modules/publication/application/services/get-published-chapter.js";
import { DrizzlePublishedChapterRepository } from "../modules/publication/infrastructure/persistence/drizzle/published-chapter.repository.js";
import { DrizzlePublicMediaOriginResolver } from "../modules/storage-profiles/infrastructure/persistence/drizzle/public-media-origin.resolver.js";
import { ListUploadOperationsService } from "../modules/uploads/application/services/list-upload-operations.service.js";
import { RetryUploadOperationService } from "../modules/uploads/application/services/retry-upload-operation.service.js";
import { DrizzleRetryUploadOperationRepository } from "../modules/uploads/infrastructure/persistence/drizzle/retry-upload-operation.repository.js";
import { DrizzleUploadOperationReadRepository } from "../modules/uploads/infrastructure/persistence/drizzle/upload-operation-read.repository.js";
import { UnavailableUploadTransfer } from "../modules/uploads/infrastructure/storage/unavailable-upload-transfer.js";
import {
  DrizzleOperationAuditWriter,
  type OperationAuditWriter,
} from "../observability/operation-audit-writer.js";

export interface AppDependencies {
  database?: NodeProxDatabase;
  storageProfileConfig?: NodeProxStorageProfileConfig;
  secureCookie?: boolean;
  storage?: NodeProxStorageConfig;
  uploadTransfer?: UploadTransferPort;
  storageExecution?: StorageExecutionResolver;
  storageAdministration?: ManagedStorageAdministrationResolver;
  storageProfileProviders?: StorageProfileProviderOverrides;
  activeStorageProfile?: ActiveStorageProfilePort;
  publicMediaOrigin?: string;
  operationAuditWriter?: OperationAuditWriter;
  seriesChannelGateway?: DiscordSeriesChannelGateway;
  discord?: {
    internalToken?: string | undefined;
    botInternalUrl?: string | undefined;
    redisUrl: string;
    guildId?: string | undefined;
    controlChannelId?: string | undefined;
  };
}

export type ApiCompositionInput = AppDependencies & {
  config?: NodeProxConfig;
  environment?: Readonly<Record<string, string | undefined>>;
};

export function createApiDependencies(input: ApiCompositionInput = {}) {
  const environment = input.environment ?? process.env;
  const connection =
    input.config && !input.database
      ? createDatabase(input.config.DATABASE_URL)
      : undefined;
  const database = input.database ?? connection?.db;
  const storageConfig = input.storage ?? {
    provider: "filesystem" as const,
    uploadMaxSizeBytes: 536870912,
  };
  const uploadTransfer =
    input.uploadTransfer ??
    (storageConfig.provider === "b2"
      ? new B2UploadTransfer(storageConfig.b2)
      : new UnavailableUploadTransfer());
  const imageStorage =
    storageConfig.provider === "b2"
      ? new B2Storage(storageConfig.b2)
      : new FilesystemStorage(join(process.cwd(), ".nodeprox-storage"));
  const storageProfileConfig =
    input.storageProfileConfig ?? loadStorageProfileConfig(environment);
  const profileRuntime = database
    ? new DrizzleStorageProfileRuntimeRepository(database)
    : undefined;
  const activeStorageProfile = input.activeStorageProfile ?? profileRuntime;
  const storageExecution =
    input.storageExecution ??
    (profileRuntime
      ? new StorageClientRegistry(
          (id) => profileRuntime.loadRuntimeProfile(id),
          { storage: imageStorage, transfer: uploadTransfer },
          storageProfileConfig.STORAGE_PROFILE_MASTER_KEY,
        )
      : undefined);
  const storageAdministration =
    input.storageAdministration ??
    (storageExecution instanceof StorageClientRegistry
      ? storageExecution
      : undefined);
  const storageProfileControl =
    database && storageAdministration
      ? createStorageProfileControl({
          database,
          config: storageProfileConfig,
          administration: storageAdministration,
          ...(input.storageProfileProviders
            ? { providers: input.storageProfileProviders }
            : {}),
        })
      : undefined;
  const requireStorageRuntime = () => {
    if (!storageExecution || !activeStorageProfile)
      throw new Error("api-storage-profile-runtime-required");
    return { storageExecution, activeStorageProfile };
  };
  const publicMediaOrigin =
    input.publicMediaOrigin ?? DEFAULT_PUBLIC_MEDIA_ORIGIN;
  const publicMediaOriginResolver = database
    ? new DrizzlePublicMediaOriginResolver(
        database,
        publicMediaOrigin,
        environment.NODE_ENV === "production",
      )
    : publicMediaOrigin;
  const seriesChannelGateway =
    input.seriesChannelGateway ??
    (input.discord?.botInternalUrl && input.discord.internalToken
      ? new DiscordBotSeriesChannelGateway(
          input.discord.botInternalUrl,
          input.discord.internalToken,
        )
      : undefined);
  const email =
    environment.EMAIL_PROVIDER === "brevo" &&
    environment.BREVO_API_KEY &&
    environment.EMAIL_FROM_EMAIL
      ? new BrevoTransactionalEmail({
          apiKey: environment.BREVO_API_KEY,
          fromEmail: environment.EMAIL_FROM_EMAIL,
          fromName: environment.EMAIL_FROM_NAME ?? "NodeProx",
        })
      : new NoopTransactionalEmail();

  return {
    database,
    storageProfileConfig,
    activeStorageProfile,
    storageExecution,
    storageAdministration,
    storageProfileControl,
    connection,
    secureCookie: input.secureCookie ?? false,
    storageConfig,
    uploadTransfer,
    imageStorage,
    publicMediaOrigin,
    publicMediaOriginResolver,
    seriesChannelGateway,
    discord: input.discord,
    email,
    account: {
      publicUrl: environment.APP_PUBLIC_URL ?? "http://localhost:3000",
      resetTtlMinutes: Number(environment.PASSWORD_RESET_TTL_MINUTES ?? 30),
    },
    operationAuditWriter:
      input.operationAuditWriter ??
      (database ? new DrizzleOperationAuditWriter(database) : undefined),
    domainEvents: new DrizzleDomainEventOutbox(),
    notificationRepository: database
      ? new DrizzleNotificationRepository(database)
      : undefined,
    createSeriesGrantServices(authorization: AuthorizationService) {
      if (!database) throw new Error("api-database-required");
      return {
        list: new ListSeriesCreationGrantsForAdministrationService(
          database,
          authorization,
        ),
        commands: new WebSeriesCreationGrantService(
          database,
          authorization,
          this.domainEvents,
        ),
      };
    },
    createDiscordServices(
      authorization: AuthorizationService,
      logger: FastifyBaseLogger,
    ) {
      if (!database || !input.discord) return null;
      const discord = input.discord;
      const verifier =
        discord.botInternalUrl && discord.internalToken
          ? new DiscordBotGuildRoleVerifier(
              discord.botInternalUrl,
              discord.internalToken,
            )
          : undefined;
      return {
        service: new DiscordGatewayService(
          database,
          new RedisLinkCodeStore(discord.redisUrl),
          this.domainEvents,
          discord.guildId && discord.controlChannelId
            ? {
                guildId: discord.guildId,
                controlChannelId: discord.controlChannelId,
              }
            : undefined,
          verifier,
          seriesChannelGateway,
          (error) =>
            logger.error(
              { err: error },
              "Discord link challenge finalize failed after durable confirmation",
            ),
        ),
        admin: verifier
          ? new DiscordRoleConfigurationService(
              new DrizzleDiscordAuthorizedRoleConfigurationRepository(database),
              authorization,
              verifier,
            )
          : undefined,
      };
    },
    createChapterReplacementServices(
      chapterPermissions: ChapterPermissionService,
      logger: FastifyBaseLogger,
    ) {
      if (!database) throw new Error("api-database-required");
      const { storageExecution, activeStorageProfile } =
        requireStorageRuntime();
      const processingRepository =
        new DrizzleChapterReplacementProcessingRepository(database);
      const operations = new DrizzleChapterReplacementRepository(database);
      const activation = new ChapterMediaActivationService(
        operations,
        new DrizzleChapterMediaReplacementRepository(
          database,
          publicMediaOriginResolver,
        ),
        chapterPermissions,
      );
      return {
        prepare: new PrepareChapterReplacementService(
          chapterPermissions,
          processingRepository,
          storageExecution,
          activeStorageProfile,
          storageConfig.uploadMaxSizeBytes,
          logger,
        ),
        completeUpload: new CompleteChapterReplacementUploadService(
          processingRepository,
          storageExecution,
          chapterPermissions,
        ),
        finalize: new FinalizeChapterReplacementService(
          operations,
          activation,
          chapterPermissions,
        ),
      };
    },
    createUploadCenterService() {
      if (!database) throw new Error("api-database-required");
      return new ListUploadOperationsService(
        new DrizzleUploadOperationReadRepository(database),
      );
    },
    createRetryUploadOperationService(
      chapterPermissions: ChapterPermissionService,
    ) {
      if (!database) throw new Error("api-database-required");
      const { storageExecution } = requireStorageRuntime();
      return new RetryUploadOperationService(
        chapterPermissions,
        new DrizzleRetryUploadOperationRepository(database),
        storageExecution,
      );
    },
    createImageServices(chapterPermissions: ChapterPermissionService) {
      if (!database) throw new Error("api-database-required");
      const { storageExecution, activeStorageProfile } =
        requireStorageRuntime();
      const imageRepository = new DrizzleImageRepository(database);
      const imageReplacementOperations =
        new DrizzleImageReplacementOperationRepository(database);
      return {
        query: new ImageQueryService(
          imageRepository,
          chapterPermissions,
          storageExecution,
        ),
        prepare: new PrepareImageReplacementService(
          imageRepository,
          chapterPermissions,
          imageReplacementOperations,
          new DrizzleMediaReplacementRepository(database),
          activeStorageProfile,
          storageConfig.uploadMaxSizeBytes,
        ),
        complete: new CompleteImageReplacementService(
          imageReplacementOperations,
          storageExecution,
          chapterPermissions,
        ),
      };
    },
    createPublicationService() {
      if (!database) throw new Error("api-database-required");
      return new GetPublishedChapter(
        new DrizzlePublishedChapterRepository(database),
        publicMediaOriginResolver,
      );
    },
  };
}

export type ApiDependencies = ReturnType<typeof createApiDependencies>;
