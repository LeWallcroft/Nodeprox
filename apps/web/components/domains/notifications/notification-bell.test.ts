import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("NotificationBell", () => {
  it("keeps an accessible bell trigger and compact unread badge", () => {
    const source = readFileSync(
      "apps/web/components/domains/notifications/notification-bell.tsx",
      "utf8",
    );
    expect(source).toContain("aria-label");
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source).toContain("formatUnreadCount(unreadCount)");
    expect(source).toContain("<Bell");
  });

  it("uses the allowlisted action resolver before navigation", () => {
    const source = readFileSync(
      "apps/web/components/domains/notifications/notification-bell.tsx",
      "utf8",
    );
    expect(source).toContain(
      "resolveNotificationAction(notification.actionKey)",
    );
    expect(source).toContain("if (destination) router.push(destination)");
    expect(source).not.toContain("router.push(notification.actionKey)");
  });

  it("closes the panel when pointer or keyboard focus moves outside", () => {
    const source = readFileSync(
      "apps/web/components/domains/notifications/notification-bell.tsx",
      "utf8",
    );
    expect(source).toContain(
      'addEventListener("pointerdown", closeWhenLeaving)',
    );
    expect(source).toContain('addEventListener("focusin", closeWhenLeaving)');
    expect(source).toContain("!root.current?.contains(event.target)");
  });
});
