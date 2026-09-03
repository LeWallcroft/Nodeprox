import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MobileDrawer } from "./mobile-drawer";

vi.mock("./sidebar", () => ({
  Sidebar: () => <aside aria-label="Navegación principal" />,
}));
vi.mock("./topbar", () => ({
  Topbar: () => <div data-topbar="true" />,
}));

import { AppShell } from "./app-shell";

describe("App Shell", () => {
  it("renders authenticated content inside the shell", () => {
    const queryClient = new QueryClient();
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={queryClient}>
        <AppShell
          user={{ id: "user-1", email: "active@example.com", status: "active" }}
          capabilities={["series.read"]}
        >
          <p>Contenido protegido</p>
        </AppShell>
      </QueryClientProvider>,
    );
    expect(markup).toContain("Navegación principal");
    expect(markup).toContain('data-topbar="true"');
    expect(markup).toContain("Contenido protegido");
    expect(markup).toContain("Cargas");
    expect(markup).toContain("h-dvh");
    expect(markup).toContain(
      "min-h-0 flex-1 overflow-x-hidden overflow-y-auto",
    );
  });

  it("renders the mobile drawer backdrop only while open", () => {
    const open = renderToStaticMarkup(
      <MobileDrawer open onClose={() => undefined}>
        <aside>Menú</aside>
      </MobileDrawer>,
    );
    const closed = renderToStaticMarkup(
      <MobileDrawer open={false} onClose={() => undefined}>
        <aside>Menú</aside>
      </MobileDrawer>,
    );
    expect(open).toContain("Cerrar navegación");
    expect(closed).not.toContain("Cerrar navegación");
  });
});
