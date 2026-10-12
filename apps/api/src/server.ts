import {
  loadConfig,
  loadDomainEventDispatchConfig,
  loadProcessingConfig,
  loadStorageConfig,
} from "@nodeprox/config";
import { buildApp } from "./app.js";
import { createApiDependencies } from "./composition/create-api-dependencies.js";
import { createApiRuntime } from "./composition/create-api-runtime.js";

const config = loadConfig();
const dependencies = createApiDependencies({
  config,
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
});
const app = buildApp({ logger: { level: config.LOG_LEVEL } }, dependencies);
const runtime = createApiRuntime({
  dependencies,
  config,
  processing: loadProcessingConfig(),
  domainEvents: loadDomainEventDispatchConfig(),
  logger: app.log,
});
runtime.start();

let stopping: Promise<void> | null = null;
function shutdown(): Promise<void> {
  if (stopping) return stopping;
  stopping = (async () => {
    try {
      await runtime.stop();
    } finally {
      try {
        await app.close();
      } finally {
        await dependencies.connection?.sql.end();
      }
    }
  })();
  return stopping;
}
function signalShutdown() {
  void shutdown().catch((error: unknown) => {
    app.log.fatal(
      { err: error, event: "api-shutdown-failed" },
      "API shutdown failed",
    );
    process.exitCode = 1;
  });
}
process.once("SIGTERM", signalShutdown);
process.once("SIGINT", signalShutdown);

let fatalStarted = false;
function fatal(
  reason: unknown,
  event: "uncaughtException" | "unhandledRejection",
) {
  if (fatalStarted) return;
  fatalStarted = true;
  process.exitCode = 1;
  app.log.fatal({ err: reason, event }, "Fatal API process failure");
  void shutdown()
    .catch((error: unknown) => {
      app.log.fatal(
        { err: error, event: "api-fatal-shutdown-failed" },
        "Fatal API shutdown failed",
      );
    })
    .finally(() => process.exit(1));
}
process.once("uncaughtException", (error) => fatal(error, "uncaughtException"));
process.once("unhandledRejection", (reason) =>
  fatal(reason, "unhandledRejection"),
);

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.fatal(
    { err: error, event: "api-listen-failed" },
    "API listen failed",
  );
  process.exitCode = 1;
  await shutdown();
}
