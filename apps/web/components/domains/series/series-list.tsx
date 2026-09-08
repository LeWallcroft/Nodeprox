import { Eye } from "lucide-react";
import type { SeriesListItem } from "../../../lib/domains/series/view-model";
import {
  DataTable,
  DataTableEmptyRow,
  getSelectableTableRowProps,
  stopTableRowSelection,
} from "../../ui/data-table";
import { StatusBadge } from "../../ui/status-badge";
import { SeriesCoverPreview } from "./series-cover-preview";

function uploaderInitials(email: string | undefined) {
  return email ? email.slice(0, 1).toLocaleUpperCase() : "—";
}

export function SeriesList({
  items,
  selectedId,
  onSelect,
  minTableHeightClassName,
}: {
  items: readonly SeriesListItem[];
  selectedId: string | null;
  onSelect: (seriesId: string) => void;
  minTableHeightClassName?: string;
}) {
  return (
    <DataTable
      label="Series"
      {...(minTableHeightClassName
        ? { minHeightClassName: minTableHeightClassName }
        : {})}
    >
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
          <th className="p-3">Portada</th>
          <th className="p-3">Serie</th>
          <th className="p-3">Estado</th>
          <th className="p-3">Capítulos</th>
          <th className="p-3">Imágenes</th>
          <th className="p-3">Última actualización</th>
          <th className="p-3">Responsable</th>
          <th className="p-3">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <DataTableEmptyRow
            colSpan={8}
            title="No se encontraron resultados."
            description="No hay Series que coincidan con los filtros actuales."
          />
        ) : (
          items.map((series) => {
            const selected = selectedId === series.id;
            const responsible = series.principalUploader?.email;
            return (
              <tr
                {...getSelectableTableRowProps(() => onSelect(series.id))}
                className={`cursor-pointer border-b border-border transition-colors last:border-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? "bg-primary-soft" : "hover:bg-surface-elevated"}`}
                key={series.id}
              >
                <td className="p-3">
                  <button
                    aria-label={`Seleccionar ${series.title}`}
                    className="rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    type="button"
                    onClick={(event) => {
                      stopTableRowSelection(event);
                      onSelect(series.id);
                    }}
                  >
                    <SeriesCoverPreview
                      compact
                      coverUrl={series.coverUrl}
                      title={series.title}
                    />
                  </button>
                </td>
                <td className="min-w-[14rem] p-3">
                  <button
                    aria-pressed={selected}
                    className="grid text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    type="button"
                    onClick={(event) => {
                      stopTableRowSelection(event);
                      onSelect(series.id);
                    }}
                  >
                    <span className="line-clamp-2 font-semibold text-primary">
                      {series.title}
                    </span>
                    <span className="max-w-[18rem] truncate text-xs text-muted">
                      {series.slug}
                    </span>
                  </button>
                </td>
                <td className="p-3">
                  <StatusBadge label="Activa" tone="success" />
                </td>
                <td
                  className="p-3 text-muted"
                  title="Dato no disponible en la proyección actual"
                >
                  —
                </td>
                <td
                  className="p-3 text-muted"
                  title="Dato no disponible en la proyección actual"
                >
                  —
                </td>
                <td className="whitespace-nowrap p-3 text-muted">
                  {new Date(series.updatedAt).toLocaleDateString("es-PE")}
                </td>
                <td className="p-3">
                  {responsible ? (
                    <span className="flex min-w-36 items-center gap-2 text-sm text-muted">
                      <span
                        aria-hidden="true"
                        className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-elevated text-xs font-semibold text-text"
                      >
                        {uploaderInitials(responsible)}
                      </span>
                      <span className="max-w-36 truncate">{responsible}</span>
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="p-3">
                  <button
                    aria-label={`Ver detalle de ${series.title}`}
                    className="inline-flex size-8 items-center justify-center rounded-control border border-border bg-surface text-text hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    title="Ver detalle"
                    type="button"
                    onClick={(event) => {
                      stopTableRowSelection(event);
                      onSelect(series.id);
                    }}
                  >
                    <Eye aria-hidden="true" className="size-4" />
                  </button>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </DataTable>
  );
}
