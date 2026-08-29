import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PageHeader } from "./page-header";

describe("PageHeader back navigation", () => {
  it("renders the deterministic contextual back target", () => {
    const markup = renderToStaticMarkup(
      <PageHeader
        title="Chapters"
        back={{ label: "Volver a Series", href: "/series" }}
      />,
    );
    expect(markup).toContain("Volver a Series");
    expect(markup).toContain('href="/series"');
  });
});
