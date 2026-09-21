import type { NodeProxDiscordApi } from "../infrastructure/nodeprox-api/contracts.js";

export class LinkDiscordAccount {
  constructor(private readonly api: NodeProxDiscordApi) {}

  execute(input: {
    code: string;
    discordId: string;
    discordUsername: string;
    guildId: string;
    channelId: string;
    interactionId: string;
  }) {
    return this.api.confirmLink({ ...input, actorDiscordId: input.discordId });
  }
}
