import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState } from "../../ui/empty-state";
import { ErrorState } from "../../ui/error-state";
import { LoadingState } from "../../ui/loading-state";
import { SeriesContextPanel } from "./series-context-panel";
import { SeriesDetailPanel } from "./series-detail-panel";
import { SeriesForm } from "./series-form";
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
  it("keeps the final compact master-detail layout contract", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/series/page.tsx",
      "utf8",
    );

    expect(page).toContain('placeholder="Buscar series..."');
    expect(page).toContain('aria-label="Estado"');
    expect(page).toContain('aria-label="Responsable"');
    expect(page).not.toContain("Género");
    expect(page).not.toContain("Más filtros");
    expect(page).toContain("lg:flex-nowrap");
    expect(page).toContain("max-w-xs shrink");
    expect(page).toContain("w-36 shrink-0");
    expect(page).toContain("w-48 shrink-0");
    expect(page).toContain("Estado: Activa");
    expect(page).toContain("Responsable: Todos");
    expect(page).toContain("<AppDialog");
    expect(page).toContain('title="Nueva serie"');
    expect(page).toContain("<SeriesForm");
    expect(page).toContain("h-52 overflow-y-auto");
    expect(page).toContain("Sin actividad reciente");
    expect(page).not.toContain("proyección actual");
    expect(page).toContain("<List aria-hidden");
  });

  it("reserves a metrics placeholder without inventing values", () => {
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

    expect(markup).toContain("Métricas");
    expect(markup).toContain("Muy pronto");
    expect(markup).toContain("Disponible en una próxima versión.");
    expect(markup).not.toContain("12,450");
  });

  it("makes chapter management available from the initial real Series selection", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/series/page.tsx",
      "utf8",
    );

    expect(page).toContain("didInitializeSelection");
    expect(page).toContain("listQuery.data.find((series) => series.id)?.id");
    expect(page).toContain("setSelectedSeriesId(initialSeriesId)");
    expect(page).toContain("selectedSeriesId}/chapters");
  });

  it("keeps slug backend-owned in the Series form", () => {
    const markup = renderToStaticMarkup(
      <SeriesForm onSubmit={async () => undefined} />,
    );
    expect(markup).toContain("El slug público se genera automáticamente");
    expect(markup).not.toContain('id="series-slug"');
  });

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
    expect(markup).toContain("Portada");
    expect(markup).toContain("Estado");
    expect(markup).toContain("Capítulos");
    expect(markup).toContain("Imágenes");
    expect(markup).toContain("Última actualización");
    expect(markup).toContain("Responsable");
    expect(markup).toContain("Acciones");
    expect(markup).toContain("Activa");
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('role="button"');
    expect(markup).toContain("cursor-pointer");
    expect(markup).toContain("line-clamp-2");
    expect(markup).toContain("max-w-[18rem] truncate");
    expect(markup).toContain("min-w-[14rem]");
    expect(
      readFileSync(
        "apps/web/components/domains/series/series-list.tsx",
        "utf8",
      ),
    ).toContain("hover:bg-surface-elevated");
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
    expect(markup).toContain("Detalle de la serie");
    expect(markup).toContain("Editar serie");
    expect(markup).toContain("Eliminar serie");
    expect(markup).toContain("uploader@example.com");
    expect(markup).toContain("Copiar slug");
    expect(markup).toContain("Cambiar responsable");
    expect(markup).toContain('href="/series/series-1/chapters"');
  });

  it("keeps the detail panel compact and reserves contextual Chapters for the main area", () => {
    const markup = renderToStaticMarkup(
      <SeriesContextPanel open>
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
        />
      </SeriesContextPanel>,
    );
    expect(markup).toContain("Panel contextual de la serie");
    expect(markup).not.toContain("Chapters recientes");
    expect(markup).toContain("Activa");
    expect(markup).toContain("object-contain");
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

  it("keeps foreign Series administration hidden while exposing Chapter work", () => {
    const markup = renderToStaticMarkup(
      <SeriesDetailPanel
        series={series}
        capabilities={["series.read", "chapters.create"]}
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
    expect(markup).toContain("Gestionar capítulos");
    expect(markup).not.toContain("Editar series");
    expect(markup).not.toContain("Eliminar serie");
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
