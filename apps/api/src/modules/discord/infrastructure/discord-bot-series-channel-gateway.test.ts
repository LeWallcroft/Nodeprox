import { describe, expect, it, vi } from "vitest";
import {
  DiscordBotSeriesChannelGateway,
} from "./discord-bot-series-channel-gateway.js";
import { DiscordSeriesChannelGatewayUnavailableError } from "../application/discord-series-channel-gateway.js";

const channel = { id: "12345678901234567", name: "series-manga" };

describe("DiscordBotSeriesChannelGateway", () => {
  it("uses the shared M2M credential and maps safe list/validation contracts", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [channel] })))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ valid: true, channel })),
      );
    const gateway = new DiscordBotSeriesChannelGateway(
      "http://bot.internal",
      "internal-token",
      fetcher,
    );

    await expect(gateway.listSelectableChannels()).resolves.toEqual([channel]);
    await expect(gateway.validateChannel(channel.id)).resolves.toEqual({
      valid: true,
      channel,
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      new URL("/internal/discord/series-channels", "http://bot.internal"),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer internal-token" }),
      }),
    );
  });

  it("fails closed for malformed or unavailable bot responses", async () => {
    const malformed = new DiscordBotSeriesChannelGateway(
      "http://bot.internal",
      "token",
      vi.fn<typeof fetch>().mockResolvedValue(new Response("{}")),
    );
    await expect(malformed.listSelectableChannels()).rejects.toBeInstanceOf(
      DiscordSeriesChannelGatewayUnavailableError,
    );

    const unavailable = new DiscordBotSeriesChannelGateway(
      "http://bot.internal",
      "token",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    );
    await expect(unavailable.validateChannel(channel.id)).rejects.toBeInstanceOf(
      DiscordSeriesChannelGatewayUnavailableError,
    );
  });
});
