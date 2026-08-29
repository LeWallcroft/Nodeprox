"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Eye, Images } from "lucide-react";
import { errorMessage } from "../../../components/domains/feedback";
import { QuickChapterImagesDialog } from "../../../components/domains/chapters/quick-chapter-images-dialog";
import { PageHeader } from "../../../components/layout/page-header";
import { Button } from "../../../components/ui/button";
import { DataTable } from "../../../components/ui/data-table";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { LoadingState } from "../../../components/ui/loading-state";
import { SearchInput } from "../../../components/ui/search-input";
import { StatusBadge } from "../../../components/ui/status-badge";
import { useGlobalChapterList } from "../../../lib/domains/chapters/hooks";
import {
  chapterStatuses,
  type ChapterStatus,
} from "../../../lib/domains/chapters/types";

function tone(status: ChapterStatus) {
  if (status === "ready") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "processing") return "info" as const;
  if (status === "deleting") return "warning" as const;
  return "neutral" as const;
}

export default function GlobalChaptersPage() {
  const chapters = useGlobalChapterList();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ChapterStatus | "all">("all");
  const [quickChapter, setQuickChapter] = useState<{
    id: string;
    seriesId: string;
    seriesTitle: string;
    chapterNumber: number;
  } | null>(null);
  const items = useMemo(
    () =>
      (chapters.data ?? []).filter((chapter) => {
        const searchable =
          `${chapter.series.title} ${chapter.series.slug} ${chapter.chapterNumber} ${chapter.title ?? ""}`.toLowerCase();
        return (
          searchable.includes(query.trim().toLowerCase()) &&
          (status === "all" || chapter.status === status)
        );
      }),
    [chapters.data, query, status],
  );

  return (
    <>
      <PageHeader
        title="Capítulos"
        description="Consulta los capítulos disponibles en tus series."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Capítulos", current: true },
        ]}
      />
      <div className="mb-section flex flex-wrap gap-3">
        <div className="min-w-[16rem] flex-1">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar por serie, slug, número o título"
          />
        </div>
        <select
          aria-label="Filtrar por estado"
          value={status}
          onChange={(event) =>
            setStatus(event.target.value as ChapterStatus | "all")
          }
          className="min-h-control"
        >
          <option value="all">Todos los estados</option>
          {chapterStatuses.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      {chapters.isPending ? <LoadingState label="Cargando capítulos" /> : null}
      {chapters.isError ? (
        <ErrorState
          title="No se pudieron cargar los capítulos"
          description={errorMessage(chapters.error)}
          action={
            <Button type="button" onClick={() => void chapters.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : null}
      {chapters.isSuccess && items.length === 0 ? (
        <EmptyState
          title={
            query || status !== "all"
              ? "No se encontraron capítulos"
              : "No hay capítulos disponibles"
          }
          description="Ajusta la búsqueda o consulta otra serie."
        />
      ) : null}
      {chapters.isSuccess && items.length > 0 ? (
        <DataTable label="Capítulos globales">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
              <th className="p-3">Serie</th>
              <th className="p-3">Capítulo</th>
              <th className="p-3">Título</th>
              <th className="p-3">Estado</th>
              <th className="p-3">Actualizado</th>
              <th className="p-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((chapter) => (
              <tr
                key={chapter.id}
                className="border-b border-border last:border-0"
              >
                <td className="p-3 font-medium">
                  {chapter.series.title}
                  <span className="ml-2 text-xs text-muted">
                    {chapter.series.slug}
                  </span>
                </td>
                <td className="p-3">{chapter.chapterNumber}</td>
                <td className="p-3 text-muted">{chapter.title ?? "—"}</td>
                <td className="p-3">
                  <StatusBadge
                    label={chapter.status}
                    tone={tone(chapter.status)}
                  />
                </td>
                <td className="whitespace-nowrap p-3 text-muted">
                  {new Date(chapter.updatedAt).toLocaleDateString("es-PE")}
                </td>
                <td className="p-3">
                  <div className="flex justify-end gap-2">
                    <Link
                      aria-label={`Abrir capítulo ${chapter.chapterNumber}`}
                      title="Abrir capítulo"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-border bg-surface-elevated text-secondary hover:text-text"
                      href={`/series/${chapter.series.id}/chapters`}
                    >
                      <Eye aria-hidden="true" className="size-4" />
                    </Link>
                    <button
                      aria-label={`Imágenes del capítulo ${chapter.chapterNumber}`}
                      title="Imágenes"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-border bg-surface-elevated text-secondary hover:text-text"
                      type="button"
                      onClick={() =>
                        setQuickChapter({
                          id: chapter.id,
                          seriesId: chapter.series.id,
                          seriesTitle: chapter.series.title,
                          chapterNumber: chapter.chapterNumber,
                        })
                      }
                    >
                      <Images aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : null}
      {quickChapter ? (
        <QuickChapterImagesDialog
          open
          chapterId={quickChapter.id}
          chapterNumber={quickChapter.chapterNumber}
          seriesId={quickChapter.seriesId}
          seriesTitle={quickChapter.seriesTitle}
          onClose={() => setQuickChapter(null)}
        />
      ) : null}
    </>
  );
}
