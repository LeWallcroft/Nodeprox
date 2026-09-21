"use client";

import { FolderCog, Link2, Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssignChapterCollaboratorDialog } from "../../../components/domains/chapters/assign-chapter-collaborator-dialog";
import { ChapterDetailPanel } from "../../../components/domains/chapters/chapter-detail-panel";
import { GlobalChapterBulkUploadDialog } from "../../../components/domains/chapters/global-chapter-bulk-upload-dialog";
import { GlobalChapterCreateDialog } from "../../../components/domains/chapters/global-chapter-create-dialog";
import { QuickChapterImagesDialog } from "../../../components/domains/chapters/quick-chapter-images-dialog";
import { errorMessage } from "../../../components/domains/feedback";
import { PageHeader } from "../../../components/layout/page-header";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { ContentImage } from "../../../components/ui/content-image";
import {
  DataTable,
  DataTableEmptyRow,
  getSelectableTableRowProps,
  stopTableRowSelection,
} from "../../../components/ui/data-table";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { LoadingState } from "../../../components/ui/loading-state";
import { Pagination } from "../../../components/ui/pagination";
import { SearchInput } from "../../../components/ui/search-input";
import { SearchableCombobox } from "../../../components/ui/searchable-combobox";
import { StatusBadge } from "../../../components/ui/status-badge";
import {
  useChapter,
  useChapterCapabilities,
  useDeleteChapter,
  useGlobalChapterList,
  useUpdateChapter,
} from "../../../lib/domains/chapters/hooks";
import {
  type ChapterStatus,
  chapterStatuses,
} from "../../../lib/domains/chapters/types";

const pageSize = 10;

function tone(status: ChapterStatus) {
  if (status === "ready") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "processing") return "info" as const;
  if (status === "deleting") return "warning" as const;
  return "neutral" as const;
}

export default function GlobalChaptersPage() {
  const chapters = useGlobalChapterList();
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    null,
  );
  const didInitializeSelection = useRef(false);
  const [query, setQuery] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [status, setStatus] = useState<ChapterStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [quickChapterId, setQuickChapterId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedChapter = useMemo(
    () =>
      (chapters.data ?? []).find(
        (chapter) => chapter.id === selectedChapterId,
      ) ?? null,
    [chapters.data, selectedChapterId],
  );
  const selectedQuery = useChapter(selectedChapterId ?? "");
  const quickChapter = useMemo(
    () =>
      (chapters.data ?? []).find((chapter) => chapter.id === quickChapterId) ??
      null,
    [chapters.data, quickChapterId],
  );
  const selectedCapabilities = useChapterCapabilities(selectedChapterId ?? "");
  const update = useUpdateChapter(
    selectedChapterId ?? "",
    selectedChapter?.series.id ?? "",
  );
  const remove = useDeleteChapter(selectedChapter?.series.id ?? "");

  useEffect(() => {
    if (didInitializeSelection.current || !chapters.data?.length) return;
    const initialChapterId = chapters.data.find((chapter) => chapter.id)?.id;
    if (!initialChapterId) return;
    didInitializeSelection.current = true;
    setSelectedChapterId(initialChapterId);
  }, [chapters.data]);

  const items = useMemo(
    () =>
      (chapters.data ?? []).filter((chapter) => {
        const searchable =
          `${chapter.series.title} ${chapter.series.slug} ${chapter.chapterNumber} ${chapter.title ?? ""}`.toLowerCase();
        return (
          searchable.includes(query.trim().toLowerCase()) &&
          (!seriesId || chapter.series.id === seriesId) &&
          (status === "all" || chapter.status === status)
        );
      }),
    [chapters.data, query, seriesId, status],
  );
  const seriesOptions = useMemo(
    () =>
      [
        ...new Map(
          (chapters.data ?? []).map((chapter) => [
            chapter.series.id,
            chapter.series,
          ]),
        ).values(),
      ].sort((left, right) => left.title.localeCompare(right.title)),
    [chapters.data],
  );
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = items.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  function selectChapter(chapterId: string) {
    setActionError(null);
    setSelectedChapterId(chapterId);
  }

  async function handleDelete() {
    if (!selectedChapterId) return;
    setActionError(null);
    try {
      await remove.mutateAsync(selectedChapterId);
      setSelectedChapterId(null);
    } catch (cause) {
      setActionError(errorMessage(cause));
      throw cause;
    }
  }

  return (
    <>
      <PageHeader
        title="Capítulos (Globales)"
        description="Gestiona los capítulos disponibles en las series a las que tienes acceso."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Capítulos", current: true },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              type="button"
              onClick={() => setUploading(true)}
            >
              <Upload aria-hidden="true" className="size-4" /> Subir capítulos
            </Button>
            <Button type="button" onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" className="size-4" /> Nuevo capítulo
            </Button>
          </div>
        }
      />
      {actionError ? (
        <p className="mb-section text-sm text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
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
      {chapters.isSuccess && chapters.data.length === 0 ? (
        <EmptyState
          title="No hay capítulos disponibles"
          description="Consulta otra serie cuando haya capítulos publicados."
        />
      ) : null}
      {chapters.isSuccess && chapters.data.length > 0 ? (
        <section className="grid min-h-0 gap-card xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] xl:items-stretch">
          <main className="flex min-w-0 flex-col">
            <Card className="mb-4 flex flex-wrap items-center gap-2 p-3 lg:flex-nowrap">
              <div className="w-full max-w-xs shrink">
                <SearchInput
                  value={query}
                  onChange={(value) => {
                    setQuery(value);
                    setPage(1);
                  }}
                  placeholder="Buscar capítulos..."
                />
              </div>
              <div className="w-52 shrink-0">
                <SearchableCombobox
                  id="global-chapter-series-filter"
                  label="Serie"
                  labelHidden
                  value={seriesId}
                  options={[
                    { id: "", label: "Todas las series" },
                    ...seriesOptions.map((item) => ({
                      id: item.id,
                      label: item.title,
                    })),
                  ]}
                  onChange={(value) => {
                    setSeriesId(value);
                    setPage(1);
                  }}
                  placeholder="Todas las series"
                />
              </div>
              <div className="w-44 shrink-0">
                <SearchableCombobox
                  id="global-chapter-status-filter"
                  label="Estado"
                  labelHidden
                  value={status}
                  options={[
                    { id: "all", label: "Todos los estados" },
                    ...chapterStatuses.map((value) => ({
                      id: value,
                      label: value,
                    })),
                  ]}
                  onChange={(value) => {
                    setStatus(value as ChapterStatus | "all");
                    setPage(1);
                  }}
                  placeholder="Todos los estados"
                />
              </div>
            </Card>
            <DataTable
              label="Capítulos globales"
              minHeightClassName="lg:min-h-[700px]"
              tableClassName="min-w-0 table-fixed"
            >
              <colgroup>
                <col className="w-16" />
                <col className="w-[32%]" />
                <col className="w-[13%]" />
                <col className="w-[10%]" />
                <col className="w-[8%]" />
                <col className="w-[14%]" />
                <col className="w-24" />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="p-3">Portada</th>
                  <th className="p-3">Serie</th>
                  <th className="p-3">Capítulo</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Imágenes</th>
                  <th className="p-3">Última actualización</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 ? (
                  <DataTableEmptyRow
                    colSpan={7}
                    title="No se encontraron resultados."
                    description="No hay capítulos que coincidan con los filtros actuales."
                  />
                ) : (
                  pageItems.map((chapter) => {
                    const selected = selectedChapterId === chapter.id;
                    return (
                      <tr
                        {...getSelectableTableRowProps(() =>
                          selectChapter(chapter.id),
                        )}
                        className={`cursor-pointer border-b border-border transition-colors last:border-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected ? "bg-primary-soft" : "hover:bg-surface-elevated"}`}
                        key={chapter.id}
                      >
                        <td className="p-3">
                          <ContentImage
                            alt={`Portada de ${chapter.series.title}`}
                            src={chapter.series.coverUrl}
                            variant="thumbnail"
                          />
                        </td>
                        <td className="min-w-0 p-0 font-medium">
                          <button
                            aria-pressed={selected}
                            className="grid h-[60px] w-full grid-rows-[2rem_1rem] px-3 py-2 text-left text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                            type="button"
                            onClick={(event) => {
                              stopTableRowSelection(event);
                              selectChapter(chapter.id);
                            }}
                          >
                            <span className="line-clamp-2 h-8 overflow-hidden font-semibold leading-4 text-primary">
                              {chapter.series.title}
                            </span>
                            <span className="h-4 max-w-[18rem] truncate text-xs leading-4 text-muted">
                              {chapter.series.slug}
                            </span>
                          </button>
                        </td>
                        <td className="p-3">
                          {chapter.chapterNumber}
                          {chapter.title ? (
                            <span className="block max-w-40 truncate text-xs text-muted">
                              {chapter.title}
                            </span>
                          ) : null}
                        </td>
                        <td className="p-3">
                          <StatusBadge
                            label={chapter.status}
                            tone={tone(chapter.status)}
                          />
                        </td>
                        <td className="p-3 text-muted">{chapter.imageCount}</td>
                        <td className="whitespace-nowrap p-3 text-muted">
                          {new Date(chapter.updatedAt).toLocaleDateString(
                            "es-PE",
                          )}
                        </td>
                        <td className="p-3">
                          <div className="flex justify-end gap-1.5">
                            <button
                              aria-label={`Copiar enlaces de imágenes del capítulo ${chapter.chapterNumber}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-border bg-surface-elevated text-secondary hover:bg-surface-hover hover:text-text"
                              title="Enlaces de imágenes"
                              type="button"
                              onClick={(event) => {
                                stopTableRowSelection(event);
                                setQuickChapterId(chapter.id);
                              }}
                            >
                              <Link2 aria-hidden="true" className="size-4" />
                            </button>
                            <Link
                              aria-label={`Gestionar capítulo ${chapter.chapterNumber}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-border bg-surface-elevated text-secondary hover:bg-surface-hover hover:text-text"
                              href={`/series/${chapter.series.id}/chapters/${chapter.id}/images`}
                              title="Gestionar capítulo"
                              onClick={stopTableRowSelection}
                            >
                              <FolderCog
                                aria-hidden="true"
                                className="size-4"
                              />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </DataTable>
            <div className="mt-3">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                totalItems={items.length}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            </div>
          </main>
          <aside
            aria-label="Detalles del capítulo"
            className="min-h-0 w-full overflow-y-auto xl:h-full xl:self-stretch"
          >
            {selectedChapterId && selectedQuery.isPending ? (
              <LoadingState label="Cargando detalle del capítulo" />
            ) : null}
            {selectedChapterId && selectedQuery.isError ? (
              <ErrorState
                title="No se pudo cargar el detalle"
                description={errorMessage(selectedQuery.error)}
                action={
                  <Button
                    type="button"
                    onClick={() => void selectedQuery.refetch()}
                  >
                    Reintentar
                  </Button>
                }
              />
            ) : null}
            {!selectedChapterId || selectedQuery.isSuccess ? (
              <ChapterDetailPanel
                chapter={selectedQuery.data ?? null}
                globalChapter={selectedChapter}
                capabilities={selectedCapabilities.data?.capabilities}
                onClose={() => setSelectedChapterId(null)}
                onAssignCollaborator={() => setAssigning(true)}
                onUpdate={async (input) => {
                  if (!selectedChapterId) return;
                  await update.mutateAsync(input);
                }}
                onDelete={handleDelete}
                updatePending={update.isPending}
                deletePending={remove.isPending}
              />
            ) : null}
          </aside>
        </section>
      ) : null}
      <GlobalChapterCreateDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(chapterId) => {
          void chapters.refetch();
          selectChapter(chapterId);
        }}
      />
      <GlobalChapterBulkUploadDialog
        open={uploading}
        onOpenChange={setUploading}
      />
      {selectedChapter ? (
        <AssignChapterCollaboratorDialog
          chapterId={selectedChapter.id}
          chapterNumber={selectedChapter.chapterNumber}
          open={assigning}
          onClose={() => setAssigning(false)}
        />
      ) : null}
      {quickChapter ? (
        <QuickChapterImagesDialog
          open
          chapterId={quickChapter.id}
          chapterNumber={quickChapter.chapterNumber}
          seriesId={quickChapter.series.id}
          seriesTitle={quickChapter.series.title}
          onClose={() => setQuickChapterId(null)}
        />
      ) : null}
    </>
  );
}
