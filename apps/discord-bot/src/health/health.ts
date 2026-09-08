export type BotHealthStatus = "starting" | "ready" | "degraded" | "stopping";

export type BotHealth = {
  status: BotHealthStatus;
  discordConnected: boolean;
};

export class BotHealthState {
  private value: BotHealth = { status: "starting", discordConnected: false };

  snapshot(): BotHealth {
    return { ...this.value };
  }

  markReady() {
    this.value = { status: "ready", discordConnected: true };
  }

  markDegraded() {
    this.value = { status: "degraded", discordConnected: false };
  }

  markStopping() {
    this.value = { status: "stopping", discordConnected: false };
  }
}
