import "dotenv/config";
import { loadConfig } from "@nodeprox/config";
import { buildApp } from "./app.js";

const config = loadConfig();
const app = buildApp({ logger: { level: config.LOG_LEVEL } });

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
