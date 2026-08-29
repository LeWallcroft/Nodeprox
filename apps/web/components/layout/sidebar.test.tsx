import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/series/series-1/chapters",
}));

import { Sidebar } from "./sidebar";

describe("Sidebar", () => {
  it("renders the supported grouped IA with capability filtering", () => {
    const markup = renderToStaticMarkup(
      <Sidebar capabilities={["series.read", "admin.system.manage"]} />,
    );
    expect(markup).toContain("Principal");
    expect(markup).toContain("Contenido");
    expect(markup).toContain("Administración");
    expect(markup).toContain("Series");
    expect(markup).toContain("Configuración");
    expect(markup).toContain("lucide-layout-dashboard");
    expect(markup).toContain("lucide-layers");
    expect(markup).toContain("lucide-settings");
    expect(markup).not.toContain("Cargas");
    expect(markup).not.toContain("Enlaces");
  });

  it("keeps Series active for the contextual Chapters route", () => {
    const markup = renderToStaticMarkup(
      <Sidebar capabilities={["series.read"]} />,
    );
    expect(markup).toContain('href="/series"');
    expect(markup).toContain('aria-current="page"');
  });

  it("keeps collapsed navigation icon-only and accessible", () => {
    const markup = renderToStaticMarkup(
      <Sidebar capabilities={["series.read"]} initialCollapsed />,
    );
    expect(markup).toContain('aria-label="Series"');
    expect(markup).toContain('title="Series"');
    expect(markup).toContain("lucide-layers");
  });

  it("uses the same configured navigation inside MobileDrawer", () => {
    const markup = renderToStaticMarkup(
      <Sidebar capabilities={["series.read"]} />,
    );
    expect(markup).toContain("Navegación principal");
    expect(markup).toContain("lucide-layers");
  });
});
