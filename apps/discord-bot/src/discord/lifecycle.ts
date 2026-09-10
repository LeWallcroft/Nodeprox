import { type Client, Events } from "discord.js";
import type { Logger } from "pino";
import type { BotHealthState } from "../health/health.js";
import { isInteractionLifecycleError } from "./interaction-response.js";

export function registerShutdownHandlers(
  stop: (signal: string) => Promise<void>,
) {
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

export function bindClientLifecycle(input: {
  client: Pick<Client, "once" | "on" | "destroy">;
  health: BotHealthState;
  logger: Logger;
}) {
  const stop = async (signal: string) => {
    if (input.health.snapshot().status === "stopping") return;
    input.health.markStopping();
    input.logger.info({ signal }, "discord_bot.shutdown.start");
    input.client.destroy();
    await input.logger.flush();
  };

  input.client.once(Events.ClientReady, () => {
    input.health.markReady();
    input.logger.info(
      { health: input.health.snapshot() },
      "discord_bot.gateway.ready",
    );
  });
  input.client.on(Events.Error, (error) => {
    if (isInteractionLifecycleError(error)) {
      input.logger.warn(
        { err: error },
        "discord_bot.interaction.lifecycle.error",
      );
      return;
    }
    input.health.markDegraded();
    input.logger.error(
      { err: error, health: input.health.snapshot() },
      "discord_bot.gateway.error",
    );
  });

  return stop;
}
