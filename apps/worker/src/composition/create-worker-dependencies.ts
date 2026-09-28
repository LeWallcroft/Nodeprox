import { join } from "node:path";
import {
  loadConfig,
  loadMediaEffectsConfig,
  loadProcessingConfig,
  loadStorageConfig,
  loadStorageProfileConfig,
} from "@nodeprox/config";
import { B2Storage, FilesystemStorage } from "@nodeprox/storage/adapters";
import { StorageClientRegistry } from "@nodeprox/storage/profile-execution";
import { and, eq, inArray } from "drizzle-orm";
import pino from "pino";
import { createDatabase } from "../../../../database/client.js";
import { DrizzleStorageProfileRuntimeRepository } from "../../../../database/storage-profile-runtime.js";
import {
  storageProfiles,
  systemConfig,
} from "../../../../database/schema/index.js";
import { ChapterDeletionService } from "../deletion/application/chapter-deletion.service.js";
import { DrizzleChapterDeletionRepository } from "../deletion/infrastructure/persistence/drizzle/chapter-deletion.repository.js";
import { MediaEffectProcessor } from "../media-effects/application/media-effect.processor.js";
import { CloudflareCdnInvalidationAdapter } from "../media-effects/infrastructure/cloudflare-cdn-invalidation.adapter.js";
import { DrizzleMediaEffectRepository } from "../media-effects/infrastructure/persistence/drizzle/media-effect.repository.js";
import { DrizzleChapterReplacementProcessingWorkerRepository } from "../processing/chapter-replacements/infrastructure/persistence/drizzle/chapter-replacement-processing.repository.js";
import { ChapterProcessingService } from "../processing/application/chapter-processing.service.js";
import { ChapterReplacementProcessingService } from "../processing/chapter-replacements/application/chapter-replacement-processing.service.js";
import { DrizzleProcessingRepository } from "../processing/infrastructure/persistence/drizzle/processing.repository.js";
import { UnzipperExtractor } from "../processing/infrastructure/zip/unzipper.extractor.js";
import { StorageCleanupProcessor } from "../storage-cleanup/application/storage-cleanup.processor.js";
import { DrizzleStorageCleanupRepository } from "../storage-cleanup/infrastructure/persistence/drizzle/storage-cleanup.repository.js";

export function createWorkerDependencies() {
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
        "B2_APPLICATION_KEY",
        "STORAGE_PROFILE_MASTER_KEY",
        "encryptedApplicationKey",
        "b2ApplicationKey",
        "CLOUDFLARE_PROVISIONING_API_TOKEN",
        "CLOUDFLARE_CACHE_RULES_API_TOKEN",
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
  const profileRuntime = new DrizzleStorageProfileRuntimeRepository(
    database.db,
  );
  const storageExecution = new StorageClientRegistry(
    (id) => profileRuntime.loadRuntimeProfile(id),
    { storage, transfer: null },
    loadStorageProfileConfig().STORAGE_PROFILE_MASTER_KEY,
  );
  const mediaEffectsConfig = loadMediaEffectsConfig();
  const mediaEffects = mediaEffectsConfig
    ? new MediaEffectProcessor(
        new DrizzleMediaEffectRepository(database.db),
        new CloudflareCdnInvalidationAdapter(
          mediaEffectsConfig.CLOUDFLARE_ZONE_ID,
          mediaEffectsConfig.CLOUDFLARE_PURGE_API_TOKEN,
          fetch,
          async (hostname) => {
            const [profile] = await database.db
              .select({ id: storageProfiles.id })
              .from(storageProfiles)
              .where(
                and(
                  eq(storageProfiles.publicHostname, hostname),
                  eq(storageProfiles.source, "managed"),
                  eq(storageProfiles.cloudflareProvisioningStatus, "verified"),
                ),
              )
              .limit(1);
            return Boolean(profile);
          },
        ),
        storageExecution,
        logger,
      )
    : null;
  const storageCleanup = new StorageCleanupProcessor(
    new DrizzleStorageCleanupRepository(database.db),
    storageExecution,
    logger,
  );
  const repository = new DrizzleProcessingRepository(database.db);
  const replacementRepository =
    new DrizzleChapterReplacementProcessingWorkerRepository(database.db);
  return {
    config,
    logger,
    processing,
    database,
    storage,
    storageConfig,
    repository,
    replacementRepository,
    deletion: new ChapterDeletionService(
      new DrizzleChapterDeletionRepository(database.db),
      storageExecution,
    ),
    mediaEffects,
    storageCleanup,
    createExtractor(warnings: {
      warnImageBytes: number;
      warnWidthPx: number;
      warnHeightPx: number;
    }) {
      return new UnzipperExtractor({
        maxEntries: processing.PROCESSING_MAX_ENTRIES,
        maxTotalBytes: processing.PROCESSING_MAX_TOTAL_SIZE_BYTES,
        maxImageBytes: processing.PROCESSING_MAX_IMAGE_SIZE_BYTES,
        ...warnings,
      });
    },
    createChapterProcessing(extractor: UnzipperExtractor) {
      return new ChapterProcessingService(
        repository,
        storageExecution,
        extractor,
        repository,
      );
    },
    createReplacementProcessing(extractor: UnzipperExtractor) {
      return new ChapterReplacementProcessingService(
        replacementRepository,
        storageExecution,
        extractor,
      );
    },
    async loadImageProcessingWarnings() {
      const rows = await database.db
        .select({ key: systemConfig.key, value: systemConfig.value })
        .from(systemConfig)
        .where(
          inArray(systemConfig.key, [
            "upload_warning_image_size_mb",
            "upload_warning_width_px",
            "upload_warning_height_px",
          ]),
        );
      const values = new Map(
        rows.flatMap((row) =>
          typeof row.value === "number" ? [[row.key, row.value] as const] : [],
        ),
      );
      return {
        warnImageBytes:
          (values.get("upload_warning_image_size_mb") ?? 8) * 1024 * 1024,
        warnWidthPx: values.get("upload_warning_width_px") ?? 4000,
        warnHeightPx: values.get("upload_warning_height_px") ?? 12000,
      };
    },
  };
}

export type WorkerDependencies = ReturnType<typeof createWorkerDependencies>;
