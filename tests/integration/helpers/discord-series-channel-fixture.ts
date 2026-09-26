import { randomUUID } from "node:crypto";
import type { buildApp } from "../../../apps/api/src/app.js";
import type {
  DiscordSeriesChannelGateway,
  SeriesChannelValidationResult,
} from "../../../apps/api/src/modules/discord/application/discord-series-channel-gateway.js";

const fixturePrefix = "fixture-series-channel-";

export function createFixtureDiscordChannelId(): string {
  return `${fixturePrefix}${randomUUID()}`;
}

export class FakeDiscordSeriesChannelGateway
  implements DiscordSeriesChannelGateway
{
  async listSelectableChannels() {
    return [];
  }

  async validateChannel(
    channelId: string,
  ): Promise<SeriesChannelValidationResult> {
    if (!channelId.startsWith(fixturePrefix))
      return { valid: false, reason: "not_found" };
    return {
      valid: true,
      channel: { id: channelId, name: `test-${channelId}` },
    };
  }
}

/**
 * Test-client fixture only: it makes the HTTP request explicit before it
 * reaches the application boundary. The production application never adds a
 * channel ID itself, and the fake gateway still validates every supplied ID.
 */
export function withM2DSeriesFixtures<T extends ReturnType<typeof buildApp>>(
  app: T,
): T {
  const inject = app.inject.bind(app);
  app.inject = ((options: unknown, callback?: unknown) => {
    const request = withFixtureChannel(options);
    if (callback === undefined) return inject(request as never);
    return inject(request as never, callback as never);
  }) as typeof app.inject;
  return app;
}

function withFixtureChannel(options: unknown): unknown {
  if (!options || typeof options !== "object") return options;
  const request = options as {
    method?: string;
    url?: string;
    payload?: unknown;
  };
  if (
    request.method !== "POST" ||
    request.url !== "/series" ||
    !request.payload ||
    typeof request.payload !== "object" ||
    "discordChannelId" in request.payload
  )
    return options;
  return {
    ...request,
    payload: {
      ...request.payload,
      discordChannelId: createFixtureDiscordChannelId(),
    },
  };
}
