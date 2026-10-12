import { type Client, Events } from "discord.js";
import type { Logger } from "pino";
import type { NodeProxDiscordApi } from "../infrastructure/nodeprox-api/contracts.js";

export type DiscordProfileUpdateListener = { stop(): void };

export function registerDiscordProfileUpdateListener(input: {
  client: Pick<Client, "on" | "off">;
  api: NodeProxDiscordApi;
  logger: Logger;
  coalesceMs?: number;
}): DiscordProfileUpdateListener {
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  let stopped = false;
  const onUpdate: Parameters<Client["on"]>[1] = (oldUser, newUser) => {
    if (
      stopped ||
      (oldUser.username === newUser.username &&
        oldUser.avatar === newUser.avatar)
    )
      return;
    const discordId = newUser.id;
    input.logger.info({ discordId }, "discord_bot.profile_update.detected");
    const previous = pending.get(discordId);
    if (previous) clearTimeout(previous);
    pending.set(
      discordId,
      setTimeout(() => {
        pending.delete(discordId);
        if (stopped) return;
        void input.api.notifyProfileChanged({ discordId }).then(
          () =>
            input.logger.info(
              { discordId },
              "discord_bot.profile_update.signal.sent",
            ),
          () =>
            input.logger.warn(
              { discordId },
              "discord_bot.profile_update.signal.failed",
            ),
        );
      }, input.coalesceMs ?? 2_000),
    );
  };
  input.client.on(Events.UserUpdate, onUpdate);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      input.client.off(Events.UserUpdate, onUpdate);
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    },
  };
}
