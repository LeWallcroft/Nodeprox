import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/components/domains/discord/discord-authorization-configuration.tsx",
  ),
  "utf8",
);

describe("Discord authorization configuration", () => {
  it("renders each capability as an explicit, independent selection", () => {
    expect(source).toContain('"series_grant.issue"');
    expect(source).toContain('"series_grant.invalidate"');
    expect(source).toContain('"bot.configure"');
    expect(source).toContain("discordCapabilities.map");
  });

  it("uses the authenticated admin configuration boundary", () => {
    expect(source).toContain("useDiscordAuthorizationConfiguration");
    expect(source).toContain("useReplaceDiscordAuthorizationConfiguration");
    expect(source).toContain("normalizeDiscordAuthorizedRoles(roles)");
  });

  it("does not infer configuration capability from series authorization", () => {
    expect(source).not.toContain("series_grant.issue => bot.configure");
    expect(source).toContain("Debe permanecer al menos un rol con");
  });
});
