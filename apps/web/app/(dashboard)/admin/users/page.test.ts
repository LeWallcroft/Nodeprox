import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "apps/web/app/(dashboard)/admin/users/page.tsx",
  "utf8",
);

describe("admin users identity density", () => {
  it("keeps avatars out of the dense table row and renders them in user detail", () => {
    const rowStart = source.indexOf("function UserRow(");
    const detailStart = source.indexOf("function UserDetailPanel(", rowStart);
    expect(rowStart).toBeGreaterThanOrEqual(0);
    expect(detailStart).toBeGreaterThan(rowStart);
    const row = source.slice(rowStart, detailStart);
    expect(row).not.toContain("UserAvatar");
    expect(row).not.toContain("avatarUrl");
    expect(source).toContain('<UserAvatar user={user} size="lg" />');
    expect(source).not.toMatch(/<th[^>]*(?:avatar|imagen)/i);
  });
});
