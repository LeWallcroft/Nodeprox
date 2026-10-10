import { describe, expect, it, vi } from "vitest";
import { DiscordGrantNotificationHandler } from "./discord-grant-notification.handler.js";

const event = (source: string) => ({
  id: "00000000-0000-4000-8000-000000000001",
  eventType: "series.creation_grant.issued",
  aggregateType: "series_creation_grant",
  aggregateId: "grant-1",
  actorUserId: "actor-1",
  payload: {
    targetUserId: "00000000-0000-4000-8000-000000000002",
    source,
    reference: "case-1",
  },
  occurredAt: new Date(),
  attemptCount: 1,
});

describe("DiscordGrantNotificationHandler", () => {
  it("delivers web grants to linked users and ignores Discord grants", async () => {
    const users = {
      findDiscordId: vi.fn().mockResolvedValue("12345678901234567"),
    };
    const notifications = {
      sendSeriesGrantIssued: vi
        .fn()
        .mockResolvedValue({ status: "sent", messageId: "m1" }),
    };
    const handler = new DiscordGrantNotificationHandler(users, notifications);
    await handler.handle(event("web"));
    expect(notifications.sendSeriesGrantIssued).toHaveBeenCalledWith({
      discordId: "12345678901234567",
      sourceEventId: event("web").id,
      reference: "case-1",
    });
    await handler.handle(event("discord"));
    expect(users.findDiscordId).toHaveBeenCalledTimes(1);
  });

  it("keeps transient gateway failures retryable and does not send when unlinked", async () => {
    const users = {
      findDiscordId: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("12345678901234567"),
    };
    const notifications = {
      sendSeriesGrantIssued: vi
        .fn()
        .mockRejectedValue(new Error("bot unavailable")),
    };
    const handler = new DiscordGrantNotificationHandler(users, notifications);
    await handler.handle(event("web"));
    expect(notifications.sendSeriesGrantIssued).not.toHaveBeenCalled();
    await expect(handler.handle(event("web"))).rejects.toThrow(
      "bot unavailable",
    );
  });
});
