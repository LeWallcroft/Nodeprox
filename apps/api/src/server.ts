import "dotenv/config";
import { loadConfig } from "@nodeprox/config";
import { createDatabase } from "../../../database/client.js";
import { buildApp } from "./app.js";

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = buildApp(
  { logger: { level: config.LOG_LEVEL } },
  { database: database.db, secureCookie: config.NODE_ENV === "production" },
);

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
