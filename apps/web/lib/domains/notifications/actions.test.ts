import { describe, expect, it } from "vitest";
import { formatUnreadCount, resolveNotificationAction } from "./actions";

describe("notification actions", () => {
  it("only resolves allowlisted internal destinations", () => {
    expect(resolveNotificationAction("authorizations")).toBe("/autorizaciones");
    expect(resolveNotificationAction("https://example.com")).toBeNull();
    expect(resolveNotificationAction("/series/unsafe")).toBeNull();
    expect(resolveNotificationAction(null)).toBeNull();
  });

  it("keeps the topbar badge compact", () => {
    expect(formatUnreadCount(0)).toBe("0");
    expect(formatUnreadCount(99)).toBe("99");
    expect(formatUnreadCount(100)).toBe("99+");
  });
});
