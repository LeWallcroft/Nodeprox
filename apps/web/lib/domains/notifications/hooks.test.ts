import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UNREAD_POLL_INTERVAL_MS } from "./hooks";

describe("notification hooks", () => {
  it("polls only the unread count conservatively", () => {
    expect(UNREAD_POLL_INTERVAL_MS).toBe(15_000);
    const source = readFileSync(
      "apps/web/lib/domains/notifications/hooks.ts",
      "utf8",
    );
    expect(source).toContain("useNotifications(enabled: boolean)");
    expect(source).toContain("enabled,");
    expect(source).toContain("refetchInterval: UNREAD_POLL_INTERVAL_MS");
  });

  it("invalidates both list and unread count after read mutations", () => {
    const source = readFileSync(
      "apps/web/lib/domains/notifications/hooks.ts",
      "utf8",
    );
    expect(source.match(/queryKeys\.notifications\.list\(\)/g)).toHaveLength(3);
    expect(
      source.match(/queryKeys\.notifications\.unreadCount\(\)/g),
    ).toHaveLength(3);
  });
});
