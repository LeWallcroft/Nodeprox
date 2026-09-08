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
    expect(source).toContain("Generar código de vinculación");
    expect(source).toContain("Código de vinculación");
    expect(source).toContain("/vincular codigo:");
    expect(source).toContain("expiresInSeconds");
    expect(source).toContain("CopyButton");
  });

  it("prevents duplicate generation while loading", () => {
    expect(source).toContain("disabled={generate.isPending}");
    expect(source).toContain("Generando código…");
  });

  it("does not add manual Discord identity or persistent code storage", () => {
    expect(source).not.toMatch(/discordId|discord_id/);
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("window.location");
  });
});
