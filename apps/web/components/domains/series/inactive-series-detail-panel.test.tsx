import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SeriesListProjection } from "../../../lib/domains/series/types";
import { InactiveSeriesDetailPanel } from "./inactive-series-detail-panel";

const fixture = vi.hoisted(() => ({
  capabilities: [] as string[],
  pending: false,
}));

vi.mock("../../../lib/domains/series/hooks", () => ({
  useSeriesLifecycle: () => ({
    data: {
      history: [],
      requests: fixture.pending
        ? [
            {
              id: "request-1",
              status: "pending",
              requestedAt: "2026-10-01T00:00:00.000Z",
              requestNote: null,
              resolutionNote: null,
            },
          ]
        : [],
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useSeriesCapabilities: () => ({
    data: { capabilities: fixture.capabilities },
  }),
  useSeriesLifecycleActions: () => ({
    reactivate: { isPending: false, mutateAsync: vi.fn() },
    request: { isPending: false, mutateAsync: vi.fn() },
    approve: { isPending: false, mutateAsync: vi.fn() },
    reject: { isPending: false, mutateAsync: vi.fn() },
  }),
}));

const series: SeriesListProjection = {
  id: "series-1",
  title: "Serie de prueba",
  slug: "serie-de-prueba",
  description: null,
  coverUrl: null,
  discordChannelId: null,
  discordChannelNameSnapshot: null,
  responsibleUser: null,
  createdBy: "user-1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  operationalState: "inactive",
  inactiveReason: "hiatus",
  inactiveReasonDetail: null,
  stateChangedAt: "2026-10-01T00:00:00.000Z",
  chapterCount: 1,
  imageCount: 4,
  hasPendingReactivationRequest: false,
};

function renderPanel() {
  return renderToStaticMarkup(
    <InactiveSeriesDetailPanel series={series} onClose={() => undefined} />,
  );
}

describe("Inactive Series detail actions", () => {
  it("shows an available request to Gestor and Uploader without content controls", () => {
    fixture.capabilities = ["series.read", "series.reactivation.request"];
    fixture.pending = false;
    const markup = renderPanel();
    expect(markup).toContain("Solicitar habilitación");
    expect(markup).not.toContain("Editar serie");
    expect(markup).not.toContain("Subir capítulo");
    expect(markup).not.toContain("Habilitar serie");
  });

  it("suppresses a duplicate request while one is pending", () => {
    fixture.capabilities = ["series.read", "series.reactivation.request"];
    fixture.pending = true;
    const markup = renderPanel();
    expect(markup).toContain("Solicitud pendiente");
    expect(markup).not.toContain(">Solicitar habilitación</button>");
  });

  it("shows direct reactivation and review only to administrators", () => {
    fixture.capabilities = ["series.read", "series.lifecycle.manage"];
    fixture.pending = true;
    const markup = renderPanel();
    expect(markup).toContain("Habilitar serie");
    expect(markup).toContain("Revisar solicitud");
    expect(markup).not.toContain("Solicitar habilitación");
  });
});
