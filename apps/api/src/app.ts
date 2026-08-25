import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { registerRequestContext } from "./plugins/request-context.js";
import { registerHealthController } from "./modules/health/health.controller.js";
import { HealthRepository } from "./modules/health/health.repository.js";
import { HealthService } from "./modules/health/health.service.js";
import type { NodeProxDatabase } from "../../../database/client.js";
import { registerAuthentication } from "./modules/authentication/presentation/authentication.plugin.js";
import { registerAuthorization } from "./modules/authorization/presentation/authorization.plugin.js";
import { registerChapterPermissionPlugin } from "./modules/chapters/presentation/chapter-permission.plugin.js";
import { registerSeriesPlugin } from "./modules/series/presentation/series.plugin.js";
import type { NodeProxStorageConfig } from "@nodeprox/config";
import { registerUploadPlugin } from "./modules/uploads/presentation/upload.plugin.js";
import { registerImagePlugin } from "./modules/images/presentation/image.plugin.js";
import { B2Storage } from "./modules/uploads/infrastructure/storage/b2.storage.js";
import { FilesystemStorage } from "./modules/uploads/infrastructure/storage/filesystem.storage.js";
import { join } from "node:path";
import { DEFAULT_PUBLIC_MEDIA_ORIGIN } from "@nodeprox/config";
import { DrizzleChapterCoreRepository } from "./modules/series/infrastructure/persistence/drizzle/series.repository.js";
import { DrizzleImageRepository } from "./modules/images/infrastructure/persistence/drizzle/image.repository.js";
import { DrizzlePublishedChapterRepository } from "./modules/publication/infrastructure/persistence/drizzle/published-chapter.repository.js";
import { GetPublishedChapter } from "./modules/publication/application/services/get-published-chapter.js";
import { registerPublicationPlugin } from "./modules/publication/presentation/publication.plugin.js";

export interface AppDependencies {
  database?: NodeProxDatabase;
  secureCookie?: boolean;
  storage?: NodeProxStorageConfig;
  publicMediaOrigin?: string;
}

export function buildApp(
  options: FastifyServerOptions = {},
  dependencies: AppDependencies = {},
): FastifyInstance {
  const app = Fastify({ logger: true, ...options });

  registerRequestContext(app);
  registerErrorHandler(app);
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
    const chapterPermissions = registerChapterPermissionPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
    );
    registerSeriesPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
      chapterPermissions,
    );
    registerUploadPlugin(
      app,
      dependencies.database,
      authentication,
      authorization,
      chapterPermissions,
      dependencies.storage ?? {
        provider: "filesystem",
        uploadMaxSizeBytes: 536870912,
      },
    );
    const storageConfig = dependencies.storage ?? {
      provider: "filesystem" as const,
      uploadMaxSizeBytes: 536870912,
    };
    const imageStorage =
      storageConfig.provider === "b2"
        ? new B2Storage(storageConfig.b2)
        : new FilesystemStorage(join(process.cwd(), ".nodeprox-storage"));
    registerImagePlugin(
      app,
      dependencies.database,
      authentication,
      chapterPermissions,
      imageStorage,
    );
    const publishedRepository = new DrizzlePublishedChapterRepository(
      new DrizzleChapterCoreRepository(dependencies.database),
      new DrizzleImageRepository(dependencies.database),
    );
    registerPublicationPlugin(
      app,
      new GetPublishedChapter(
        publishedRepository,
        dependencies.publicMediaOrigin ?? DEFAULT_PUBLIC_MEDIA_ORIGIN,
      ),
    );
  }

  return app;
}
