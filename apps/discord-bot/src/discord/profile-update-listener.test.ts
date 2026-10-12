import { EventEmitter } from "node:events";
import { Events } from "discord.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDiscordProfileUpdateListener } from "./profile-update-listener.js";

const first = "12345678901234567";
const second = "22345678901234567";

function setup() {
  const client = new EventEmitter();
  const api = {
    notifyProfileChanged: vi.fn().mockResolvedValue({ accepted: true }),
  };
  const logger = { info: vi.fn(), warn: vi.fn() };
  const listener = registerDiscordProfileUpdateListener({
    client: client as never,
    api: api as never,
    logger: logger as never,
    coalesceMs: 2_000,
  });
  const update = (
    id: string,
    before: string,
    after: string,
    oldAvatar = "a",
    newAvatar = "a",
  ) =>
    client.emit(
      Events.UserUpdate,
      { id, username: before, avatar: oldAvatar },
      { id, username: after, avatar: newAvatar },
    );
  return { client, api, logger, listener, update };
}

describe("Discord profile update listener", () => {
  afterEach(() => vi.useRealTimers());

  it("filters irrelevant changes and coalesces relevant changes independently per user", async () => {
    vi.useFakeTimers();
    const { api, listener, update } = setup();
    update(first, "reader", "reader");
    update(first, "reader", "new-name");
    update(first, "new-name", "new-name", "a", "b");
    update(second, "other", "other", "a", "b");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.notifyProfileChanged).toHaveBeenCalledTimes(2);
    expect(api.notifyProfileChanged).toHaveBeenCalledWith({ discordId: first });
    expect(api.notifyProfileChanged).toHaveBeenCalledWith({
      discordId: second,
    });
    listener.stop();
  });

  it("contains failed signals and removes listener and timers on stop", async () => {
    vi.useFakeTimers();
    const { client, api, logger, listener, update } = setup();
    api.notifyProfileChanged.mockRejectedValueOnce(new Error("transport"));
    update(first, "before", "after");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(logger.warn).toHaveBeenCalledWith(
      { discordId: first },
      "discord_bot.profile_update.signal.failed",
    );
    update(second, "before", "after");
    listener.stop();
    expect(client.listenerCount(Events.UserUpdate)).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.notifyProfileChanged).toHaveBeenCalledTimes(1);
  });
});
