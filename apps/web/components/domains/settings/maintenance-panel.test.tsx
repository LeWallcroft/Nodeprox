import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenancePanel } from "./maintenance-panel";

const mocked = vi.hoisted(() => ({
  status: vi.fn(),
  trigger: vi.fn(),
}));

vi.mock("../../../lib/domains/settings/hooks", () => ({
  useDiscordProfileSyncStatus: mocked.status,
  useTriggerDiscordProfileSync: mocked.trigger,
}));

vi.mock("../../ui/api-status-card", () => ({ ApiStatusCard: () => null }));

describe("Discord profile maintenance card", () => {
  beforeEach(() => {
    mocked.trigger.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      mutateAsync: vi.fn(),
    });
  });

  it("shows linked, missing-avatar and stale projection counts", () => {
    mocked.status.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: {
        linkedUsers: 14,
        missingAvatar: 2,
        staleProfiles: 3,
        oldestSyncedAt: "2026-10-11T18:00:00.000Z",
        syncRunning: false,
      },
    });
    const markup = renderToStaticMarkup(<MaintenancePanel />);
    expect(markup).toContain("Perfiles de Discord");
    expect(markup).toContain("Cuentas vinculadas");
    expect(markup).toContain(">14</dd>");
    expect(markup).toContain("Avatares faltantes");
    expect(markup).toContain("Perfiles pendientes de refresco");
    expect(markup).toContain("Sincronizar perfiles de Discord");
  });

  it("disables the trigger while a synchronization is running", () => {
    mocked.status.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: {
        linkedUsers: 14,
        missingAvatar: 0,
        staleProfiles: 14,
        oldestSyncedAt: null,
        syncRunning: true,
      },
    });
    const markup = renderToStaticMarkup(<MaintenancePanel />);
    expect(markup).toContain("Sincronizando perfiles…");
    expect(markup).toMatch(
      /<button[^>]*disabled[^>]*>.*?Sincronizando perfiles/,
    );
  });

  it("keeps other maintenance content visible when Discord status fails", () => {
    mocked.status.mockReturnValue({
      isPending: false,
      isError: true,
      error: new Error("private provider details"),
      data: undefined,
    });
    const markup = renderToStaticMarkup(<MaintenancePanel />);
    expect(markup).toContain(
      "No se pudo consultar el estado de los perfiles de Discord.",
    );
    expect(markup).toContain("Estado de servicios");
    expect(markup).toContain("Preparación de producción");
    expect(markup).not.toContain("private provider details");
  });
});
