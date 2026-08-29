import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "../../ui/empty-state";
import { ErrorState } from "../../ui/error-state";
import { LoadingState } from "../../ui/loading-state";
import { SeriesDetailPanel } from "./series-detail-panel";
import { SeriesList } from "./series-list";

const series = {
  id: "series-1",
  title: "Raven",
  slug: "raven",
  description: "Una serie real",
  coverUrl: "https://i.imgur.com/raven.jpg",
  principalUploader: { id: "uploader-1", email: "uploader@example.com" },
  createdBy: "user-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

describe("Series management presentation", () => {
  it("renders a selectable list from Series contract data", () => {
    const markup = renderToStaticMarkup(
      <SeriesList
        items={[{ ...series }]}
        selectedId="series-1"
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain("Raven");
    expect(markup).toContain("raven");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("uses contextual capabilities for detail actions and Chapters navigation", () => {
    const markup = renderToStaticMarkup(
      <SeriesDetailPanel
        series={series}
        capabilities={[
          "series.read",
          "series.edit",
          "series.delete",
          "chapters.create",
          "series.assignment.manage",
        ]}
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
        candidates={[]}
        candidatesLoading={false}
        candidatesError={null}
        assignmentPending={false}
        updatePending={false}
        deletePending={false}
        onAssignUploader={async () => undefined}
        onClearUploader={async () => undefined}
      />,
    );
    expect(markup).toContain("Editar series");
    expect(markup).toContain("Eliminar serie");
    expect(markup).toContain("uploader@example.com");
    expect(markup).toContain("Cambiar responsable");
    expect(markup).toContain('href="/series/series-1/chapters"');
  });

  it("hides contextual actions when the backend projection omits them", () => {
    const markup = renderToStaticMarkup(
      <SeriesDetailPanel
        series={series}
        capabilities={["series.read"]}
        onClose={() => undefined}
        onUpdate={async () => undefined}
        onDelete={async () => undefined}
        candidates={[]}
        candidatesLoading={false}
        candidatesError={null}
        assignmentPending={false}
        updatePending={false}
        deletePending={false}
        onAssignUploader={async () => undefined}
        onClearUploader={async () => undefined}
      />,
    );
    expect(markup).not.toContain("Editar series");
    expect(markup).not.toContain("Eliminar serie");
    expect(markup).toContain("Ver capítulos");
    expect(markup).toContain('href="/series/series-1/chapters"');
    expect(markup).not.toContain("Asignar responsable");
  });

  it("renders shared loading, empty and error states", () => {
    expect(renderToStaticMarkup(<LoadingState />)).toContain("Cargando");
    expect(
      renderToStaticMarkup(
        <EmptyState title="Vacío" description="Sin datos" />,
      ),
    ).toContain("Vacío");
    expect(renderToStaticMarkup(<ErrorState description="Falló" />)).toContain(
      "Falló",
    );
  });
});
