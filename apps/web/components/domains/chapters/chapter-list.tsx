import { Images } from "lucide-react";
import type { ChapterListItem } from "../../../lib/domains/chapters/view-model";
import { ContentImage } from "../../ui/content-image";
import { DataTable } from "../../ui/data-table";
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
  minTableHeightClassName,
}: {
  items: readonly ChapterListItem[];
  selectedId: string | null;
  onSelect: (chapterId: string) => void;
  onQuickImages: (chapter: ChapterListItem) => void;
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
          <th className="p-3">Responsable</th>
          <th className="p-3 text-right">Acciones</th>
        </tr>
      </thead>
      <tbody>
        {items.map((chapter) => {
          const selected = selectedId === chapter.id;
          return (
            <tr
              className={`border-b border-border transition-colors last:border-0 ${selected ? "bg-primary-soft" : "hover:bg-surface-elevated"}`}
              key={chapter.id}
            >
              <td className="p-0 font-medium">
                <button
                  className="flex w-full items-center gap-3 px-3 py-3 text-left text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(chapter.id)}
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
              <td className="p-3 text-muted">—</td>
              <td className="whitespace-nowrap p-3 text-muted">
                {new Date(chapter.updatedAt).toLocaleDateString("es-PE")}
              </td>
              <td className="p-3 text-muted">—</td>
              <td className="p-3 text-right">
                <button
                  className="grid h-9 w-9 place-items-center rounded-control border border-border bg-surface-elevated text-secondary hover:bg-surface-hover hover:text-text"
                  type="button"
                  aria-label="Vista rápida de imágenes"
                  title="Vista rápida de imágenes"
                  onClick={() => onQuickImages(chapter)}
                >
                  <Images aria-hidden="true" className="size-4" />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </DataTable>
  );
}
