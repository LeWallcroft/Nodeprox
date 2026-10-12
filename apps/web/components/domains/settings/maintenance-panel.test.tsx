import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MaintenancePanel } from "./maintenance-panel";

vi.mock("../../ui/api-status-card", () => ({ ApiStatusCard: () => null }));

describe("MaintenancePanel ownership", () => {
  it("does not render or own Discord profile synchronization", () => {
    const markup = renderToStaticMarkup(<MaintenancePanel />);
    expect(markup).toContain("Estado de servicios");
    expect(markup).toContain("Preparación de producción");
    expect(markup).not.toContain("Perfiles de Discord");
    expect(markup).not.toContain("Sincronizar perfiles de Discord");
  });
});
