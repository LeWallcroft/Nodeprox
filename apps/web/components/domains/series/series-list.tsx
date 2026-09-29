import type { SeriesListItem } from "../../../lib/domains/series/view-model";
import {
  DataTable,
  DataTableEmptyRow,
  getSelectableTableRowProps,
  stopTableRowSelection,
} from "../../ui/data-table";
import { StatusBadge } from "../../ui/status-badge";
import { SeriesCoverPreview } from "./series-cover-preview";

function responsibleInitials(name: string | undefined) {
  return name ? name.slice(0, 1).toLocaleUpperCase() : "—";
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
      fillRemainingSpace={Boolean(minTableHeightClassName)}
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
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <DataTableEmptyRow
            colSpan={7}
            title="No se encontraron resultados."
            description="No hay Series que coincidan con los filtros actuales."
          />
        ) : (
          items.map((series, index) => {
            const selected = selectedId === series.id;
            const responsible = series.responsibleUser;
              const responsibleName =
                responsible?.discordUsername || responsible?.email;
            return (
              <tr
                key={series.id}
                {...getSelectableTableRowProps(() => onSelect(series.id))}
                className={`h-[76px] cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${index === items.length - 1 ? "border-b-0" : "border-b border-border"} ${selected ? "bg-primary-soft" : "hover:bg-surface-elevated"}`}
              >
                <td className="p-3 align-middle">
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
                <td className="min-w-[14rem] p-3 align-middle">
                  <button
                    aria-pressed={selected}
                    className="grid min-w-0 grid-rows-[2rem_1rem] gap-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    type="button"
                    onClick={(event) => {
                      stopTableRowSelection(event);
                      onSelect(series.id);
                    }}
                  >
                    <span className="line-clamp-2 h-8 overflow-hidden text-sm leading-4 font-semibold text-text">
                      {series.title}
                    </span>
                    <span className="h-4 max-w-[18rem] truncate text-xs leading-4 text-muted">
                      {series.slug}
                    </span>
                  </button>
                </td>
                <td className="p-3 align-middle">
                  <StatusBadge label="Activa" tone="success" />
                </td>
                <td className="p-3 align-middle text-muted">
                  {series.chapterCount}
                </td>
                <td className="p-3 align-middle text-muted">
                  {series.imageCount}
                </td>
                <td className="p-3 align-middle whitespace-nowrap text-muted">
                  {new Date(series.updatedAt).toLocaleDateString("es-PE")}
                </td>
                <td className="p-3 align-middle">
                  {responsibleName ? (
                    <span className="flex min-w-36 items-center gap-2 text-sm text-muted">
                      <span
                        aria-hidden="true"
                        className="grid size-7 shrink-0 place-items-center rounded-full bg-surface-elevated text-xs font-semibold text-text"
                      >
                        {responsibleInitials(responsibleName)}
                      </span>
                      <span className="grid min-w-0 max-w-40">
                        <span className="truncate font-medium text-text">
                          {responsibleName}
                        </span>
                        {responsible?.discordUsername ? (
                          <span className="truncate text-xs text-muted">
                            {responsible.email}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </DataTable>
  );
}
