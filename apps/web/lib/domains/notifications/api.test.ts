import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMyNotifications,
  getMyNotificationUnreadCount,
  markAllMyNotificationsRead,
  markMyNotificationRead,
} from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("notification inbox API", () => {
  it("uses own-only list and unread endpoints without user input", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [], nextCursor: null }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 2 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getMyNotifications();
    await getMyNotificationUnreadCount();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/me/notifications?limit=8",
      "/api/me/notifications/unread-count",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("marks own notification state through fixed API paths", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ read: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 1 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await markMyNotificationRead("notification-1");
    await markAllMyNotificationsRead();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/me/notifications/notification-1/read",
      "/api/me/notifications/read-all",
    ]);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({ method: "POST" }),
    );
  });
});
