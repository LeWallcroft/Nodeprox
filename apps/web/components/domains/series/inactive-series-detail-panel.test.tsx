import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SeriesListProjection } from "../../../lib/domains/series/types";
import { InactiveSeriesDetailPanel } from "./inactive-series-detail-panel";
import { ReactivationRequestHistoryDialog } from "./reactivation-request-history-dialog";

const fixture = vi.hoisted(() => ({
  capabilities: [] as string[],
  pending: false,
  history: [] as Array<{
    id: string;
    previousState: "active" | "inactive";
    nextState: "active" | "inactive";
    inactiveReason: "dropped" | "hiatus" | "completed" | "other" | null;
    inactiveReasonDetail: string | null;
    actorUserId: string;
    responsibleUserIdAtEvent: string | null;
    responsibleLabelSnapshot: string | null;
    sourceReactivationRequestId: string | null;
    occurredAt: string;
  }>,
  requestStatus: "pending" as "pending" | "approved" | "rejected" | "cancelled",
  requests: [] as Array<{
    id: string;
    requestedBy: string;
    requestedByLabel: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
    requestNote: string | null;
    requestedAt: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    resolutionNote: string | null;
  }>,
}));

vi.mock("../../../lib/domains/series/hooks", () => ({
  useSeriesLifecycle: () => ({
    data: {
      history: fixture.history,
      requests: fixture.requests.length
        ? fixture.requests
        : fixture.pending
          ? [
              {
                id: "request-1",
                requestedBy: "user-1",
                requestedByLabel: "@uploader",
                status: fixture.requestStatus,
                requestedAt: "2026-10-01T00:00:00.000Z",
                requestNote: null,
                reviewedBy: null,
                reviewedAt: null,
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
  hasApprovedReactivationRequest: false,
  lastApprovedAt: null,
};

function renderPanel() {
  return renderToStaticMarkup(
    <InactiveSeriesDetailPanel series={series} onClose={() => undefined} />,
  );
}

function request(id: string, note: string) {
  return {
    id,
    requestedBy: `user-${id}`,
    requestedByLabel: `@uploader-${id}`,
    status: "rejected" as const,
    requestNote: note,
    requestedAt: "2026-10-01T00:00:00.000Z",
    reviewedBy: "admin-1",
    reviewedAt: "2026-10-02T00:00:00.000Z",
    resolutionNote: `Resolución ${id}`,
  };
}

function historyEntry(
  id: string,
  previousState: "active" | "inactive",
  nextState: "active" | "inactive",
  inactiveReason: "dropped" | "hiatus" | "completed" | "other" | null,
  inactiveReasonDetail: string | null = null,
) {
  return {
    id,
    previousState,
    nextState,
    inactiveReason,
    inactiveReasonDetail,
    actorUserId: "actor-1",
    responsibleUserIdAtEvent: null,
    responsibleLabelSnapshot: "@responsable histórico",
    sourceReactivationRequestId: null,
    occurredAt: "2026-10-01T00:00:00.000Z",
  };
}

describe("Inactive Series detail actions", () => {
  it("keeps only the two newest requests in the panel and offers the full history", () => {
    fixture.capabilities = [];
    fixture.pending = false;
    fixture.requests = [
      request("3", "Solicitud reciente"),
      request("2", "Solicitud anterior"),
      request("1", "Solicitud antigua"),
    ];

    const markup = renderPanel();
    expect(markup).toContain("Solicitud reciente");
    expect(markup).toContain("Solicitud anterior");
    expect(markup).not.toContain("Solicitud antigua");
    expect(markup).toContain("Ver más (3)");
    expect(markup).toContain(
      'aria-label="Ver más: historial completo de 3 solicitudes"',
    );
    fixture.requests = [];
  });

  it("shows full request details in the history dialog", () => {
    const markup = renderToStaticMarkup(
      <ReactivationRequestHistoryDialog
        open
        onOpenChange={() => undefined}
        seriesTitle="Serie de prueba"
        requests={[
          request("2", "Motivo detallado"),
          request("1", "Solicitud previa"),
        ]}
      />,
    );
    expect(markup).toContain("Historial de solicitudes");
    expect(markup).toContain("@uploader-2");
    expect(markup).toContain("Motivo de la solicitud");
    expect(markup).toContain("Motivo detallado");
    expect(markup).toContain("Resolución 2");
    expect(markup).toContain("Solicitud previa");
  });

  it("renders localized historical transitions and the reason snapshot", () => {
    fixture.capabilities = [];
    fixture.pending = false;
    fixture.history = [
      historyEntry(
        "inactive-event",
        "active",
        "inactive",
        "hiatus",
        "Pausa editorial temporal",
      ),
      historyEntry("active-event", "inactive", "active", "dropped"),
    ];

    const markup = renderPanel();
    expect(markup).toContain("Activa → Inactiva");
    expect(markup).toContain("Inactiva → Activa");
    expect(markup).toContain("Motivo: Hiatus");
    expect(markup).toContain("Detalle: Pausa editorial temporal");
    expect(markup).toContain("Motivo: Dropeada");
    expect(markup).toContain("Responsable: @responsable histórico");
    expect(markup).not.toContain("active → inactive");
    expect(markup).not.toContain("inactive → active");
  });

  it.each([
    ["pending", "Pendiente"],
    ["approved", "Aprobada"],
    ["rejected", "Rechazada"],
    ["cancelled", "Cancelada"],
  ] as const)("localizes request status %s", (status, label) => {
    fixture.capabilities = [];
    fixture.pending = true;
    fixture.requestStatus = status;
    fixture.history = [];
    const markup = renderPanel();
    expect(markup).toContain(`<strong>${label}</strong>`);
    expect(markup).not.toContain(`<strong>${status}</strong>`);
  });

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
    fixture.requestStatus = "pending";
    const markup = renderPanel();
    expect(markup).toContain("Solicitud pendiente");
    expect(markup).not.toContain(">Solicitar habilitación</button>");
  });

  it("shows direct reactivation and review only to administrators", () => {
    fixture.capabilities = ["series.read", "series.lifecycle.manage"];
    fixture.pending = true;
    fixture.requestStatus = "pending";
    const markup = renderPanel();
    expect(markup).toContain("Habilitar serie");
    expect(markup).toContain("Revisar solicitud");
    expect(markup).not.toContain("Solicitar habilitación");
  });
});
