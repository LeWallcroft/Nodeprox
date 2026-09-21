import { FolderCog, Link2 } from "lucide-react";
import Link from "next/link";
import type { ChapterListItem } from "../../../lib/domains/chapters/view-model";
import { ContentImage } from "../../ui/content-image";
import {
  DataTable,
  DataTableEmptyRow,
  getSelectableTableRowProps,
  stopTableRowSelection,
} from "../../ui/data-table";
import { StatusBadge } from "../../ui/status-badge";

function toneForStatus(status: ChapterListItem["status"]) {
  if (status === "ready") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "processing") return "info" as const;
  if (status === "deleting") return "warning" as const;
  return "neutral" as const;
}

export function ChapterList({
  items,
  selectedId,
  onSelect,
  onQuickImages,
  seriesId,
  minTableHeightClassName,
}: {
  items: readonly ChapterListItem[];
  selectedId: string | null;
  onSelect: (chapterId: string) => void;
  onQuickImages: (chapter: ChapterListItem) => void;
  seriesId: string;
  minTableHeightClassName?: string;
}) {
  return (
    <DataTable
      label="Capítulos de la serie"
      {...(minTableHeightClassName
        ? { minHeightClassName: minTableHeightClassName }
        : {})}
    >
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
          <th className="p-3">Capítulo</th>
          <th className="p-3">Estado</th>
          <th className="p-3">Imágenes</th>
          <th className="p-3">Última actualización</th>
          <th className="p-3 text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {items.length === 0 ? (
          <DataTableEmptyRow
            colSpan={5}
            title="No se encontraron resultados."
            description="No hay capítulos que coincidan con los filtros actuales."
          />
        ) : (
          items.map((chapter) => {
            const selected = selectedId === chapter.id;
            return (
              <tr
                {...getSelectableTableRowProps(() => onSelect(chapter.id))}
                className={`cursor-pointer border-b border-border transition-colors last:border-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? "bg-primary-soft" : "hover:bg-surface-elevated"}`}
                key={chapter.id}
              >
                <td className="p-0 font-medium">
                  <button
                    className="flex w-full items-center gap-3 px-3 py-3 text-left text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    type="button"
                    aria-pressed={selected}
                    onClick={(event) => {
                      stopTableRowSelection(event);
                      onSelect(chapter.id);
                    }}
                  >
                    <ContentImage
                      alt={`Vista previa del capítulo ${chapter.chapterNumber}`}
                      src={null}
                      variant="thumbnail"
                    />
                    <span>
                      {chapter.chapterNumber}
                      {chapter.title ? (
                        <span className="block max-w-40 truncate text-xs text-muted">
                          {chapter.title}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </td>
                <td className="p-3">
                  <StatusBadge
                    label={chapter.status}
                    tone={toneForStatus(chapter.status)}
                  />
                </td>
                <td className="p-3 text-muted">{chapter.imageCount}</td>
                <td className="whitespace-nowrap p-3 text-muted">
                  {new Date(chapter.updatedAt).toLocaleDateString("es-PE")}
                </td>
                <td className="p-3 text-right">
                  <div className="flex justify-end gap-1.5">
                    <button
                      className="grid h-9 w-9 place-items-center rounded-control border border-border bg-surface-elevated text-secondary hover:bg-surface-hover hover:text-text"
                      type="button"
                      aria-label="Enlaces de imágenes"
                      title="Enlaces de imágenes"
                      onClick={(event) => {
                        stopTableRowSelection(event);
                        onQuickImages(chapter);
                      }}
                    >
                      <Link2 aria-hidden="true" className="size-4" />
                    </button>
                    <Link
                      className="grid h-9 w-9 place-items-center rounded-control border border-border bg-surface-elevated text-secondary hover:bg-surface-hover hover:text-text"
                      href={`/series/${seriesId}/chapters/${chapter.id}/images`}
                      aria-label="Gestionar capítulo"
                      title="Gestionar capítulo"
                      onClick={stopTableRowSelection}
                    >
                      <FolderCog aria-hidden="true" className="size-4" />
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </DataTable>
  );
}
