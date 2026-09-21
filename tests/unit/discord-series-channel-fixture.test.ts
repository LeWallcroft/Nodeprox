import { describe, expect, it } from "vitest";
import {
  createFixtureDiscordChannelId,
  FakeDiscordSeriesChannelGateway,
} from "../integration/helpers/discord-series-channel-fixture.js";

describe("M2D integration channel fixtures", () => {
  it("creates distinct fixture channel IDs", () => {
    expect(createFixtureDiscordChannelId()).not.toBe(
      createFixtureDiscordChannelId(),
    );
  });

  it("validates only generated fixture channels with authoritative metadata", async () => {
    const gateway = new FakeDiscordSeriesChannelGateway();
    const id = createFixtureDiscordChannelId();
    await expect(gateway.validateChannel(id)).resolves.toEqual({
      valid: true,
      channel: { id, name: `test-${id}` },
    });
    await expect(gateway.validateChannel("unknown-channel")).resolves.toEqual({
      valid: false,
      reason: "not_found",
    });
  });
});
