import type { SeriesListItem } from "../../../lib/domains/series/view-model";
import { DataTable } from "../../ui/data-table";
import { SeriesCoverPreview } from "./series-cover-preview";

export function SeriesList({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly SeriesListItem[];
  selectedId: string | null;
  onSelect: (seriesId: string) => void;
}) {
  return (
    <DataTable label="Series">
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
          <th className="p-3">Series</th>
          <th className="p-3">Slug público</th>
          <th className="p-3">Descripción</th>
          <th className="p-3">Responsable</th>
          <th className="p-3">Actualizada</th>
        </tr>
      </thead>
      <tbody>
        {items.map((series) => {
          const selected = selectedId === series.id;
          return (
            <tr
              className={`border-b border-border transition-colors last:border-0 ${selected ? "bg-primary-soft" : "hover:bg-surface-elevated"}`}
              key={series.id}
            >
              <td className="p-0 font-semibold">
                <button
                  className="flex w-full items-center gap-3 px-3 py-3 text-left text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(series.id)}
                >
                  <SeriesCoverPreview
                    compact
                    coverUrl={series.coverUrl}
                    title={series.title}
                  />
                  <span>{series.title}</span>
                </button>
              </td>
              <td className="p-3 text-muted">{series.slug}</td>
              <td className="max-w-80 truncate p-3 text-muted">
                {series.description || "—"}
              </td>
              <td className="max-w-48 truncate p-3 text-muted">
                {series.principalUploader?.email ?? "—"}
              </td>
              <td className="whitespace-nowrap p-3 text-muted">
                {new Date(series.updatedAt).toLocaleDateString("es-PE")}
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
