import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchableCombobox } from "./searchable-combobox";

describe("SearchableCombobox", () => {
  it("renders the shared accessible dark selection primitive", () => {
    const markup = renderToStaticMarkup(
      <SearchableCombobox
        id="grant"
        label="Autorización"
        value="grant-1"
        options={[{ id: "grant-1", label: "NPX-SER-001 — Referencia" }]}
        onChange={() => undefined}
      />,
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-autocomplete="list"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("NPX-SER-001 — Referencia");
  });

  it("keeps keyboard navigation and selected-state behavior in the shared implementation", () => {
    const source = readFileSync(
      "apps/web/components/ui/searchable-combobox.tsx",
      "utf8",
    );

    expect(source).toContain('role="listbox"');
    expect(source).toContain('role="option"');
    expect(source).toContain("aria-selected");
    expect(source).toContain('event.key === "ArrowDown"');
    expect(source).toContain('event.key === "ArrowUp"');
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain('event.key === "Enter"');
    expect(source).toContain("bg-primary-soft");
    expect(source).toContain("overflow-y-auto");
    expect(source).toContain('className="fixed z-[70]');
    expect(source).toContain("getBoundingClientRect");
  });
});
