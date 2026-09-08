import { startBot } from "./bootstrap.js";
import { createBotLogger } from "./observability/logger.js";

async function main(): Promise<void> {
  await startBot();
}

void main().catch(async (error: unknown) => {
  const logger = createBotLogger(process.env.LOG_LEVEL ?? "info");
  logger.fatal({ err: error }, "discord_bot.startup.failed");
  await logger.flush();
  process.exitCode = 1;
});
