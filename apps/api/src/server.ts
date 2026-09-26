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

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await runtime.stop();
  await app.close();
  await dependencies.connection?.sql.end();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
