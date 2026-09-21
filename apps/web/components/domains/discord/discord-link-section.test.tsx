import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(
    process.cwd(),
    "apps/web/components/domains/discord/discord-link-section.tsx",
  ),
  "utf8",
);

describe("Discord link-code section", () => {
  it("renders the generation action and Discord instructions", () => {
    expect(source).toContain("Vincular Discord");
    expect(source).toContain("Copia el código");
    expect(source).toContain("/vincular codigo:");
    expect(source).toContain("expiresAt");
    expect(source).toContain("CopyButton");
  });

  it("prevents duplicate generation while loading", () => {
    expect(source).toContain("loading={generate.isPending && !dialogOpen}");
    expect(source).toContain("loading={loading}");
  });

  it("renders read-only linked identity details without persistent code storage", () => {
    expect(source).toContain("linkedStatus.discordId");
    expect(source).toContain("linkedStatus.discordUsername");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("window.location");
    expect(source).not.toContain("Desvincular");
  });
});
