import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Quick Chapter Images dialog", () => {
  it("keeps compact canonical actions and the real Chapter context", () => {
    const modal = readFileSync(
      "apps/web/components/domains/chapters/quick-chapter-images-dialog.tsx",
      "utf8",
    );

    expect(modal).toContain("description={`Capítulo");
    expect(modal).toContain("Gestionar");
    expect(modal).toContain('aria-label="Gestionar capítulo"');
    expect(modal).toContain("/series/");
    expect(modal).toContain("/images");
    expect(modal).toContain("Copiar todos los links");
    expect(modal).toContain("Todos los links copiados");
    expect(modal).toContain("flex flex-nowrap items-center justify-end");
    expect(modal).toContain("publicImageUrlsText(images)");
    expect(modal).toContain('label="Copiar URL"');
    expect(modal).not.toContain("Miniatura");
    expect(modal).not.toContain("Banner");
    expect(modal).not.toContain("Listo");
  });

  it("uses one centered row separator and visible action hierarchy", () => {
    const modal = readFileSync(
      "apps/web/components/domains/chapters/quick-chapter-images-dialog.tsx",
      "utf8",
    );

    expect(modal).toContain("h-20 border-b border-border last:border-0");
    expect(modal).toContain("[&>td]:align-middle");
    expect(modal).toContain("border-primary bg-primary-soft");
    expect(modal).toContain("font-medium text-primary transition-colors");
    expect(modal).toContain('className="shrink-0"');
    expect(modal).toContain(
      "bg-surface-elevated text-text hover:bg-surface-hover",
    );
  });
});
