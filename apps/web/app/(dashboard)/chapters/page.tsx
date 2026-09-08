"use client";

import {
  Clock3,
  Images,
  ListPlus,
  Plus,
  Upload,
  UserRoundPlus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssignChapterCollaboratorDialog } from "../../../components/domains/chapters/assign-chapter-collaborator-dialog";
import { BulkChapterUploadDialog } from "../../../components/domains/chapters/bulk-chapter-upload-dialog";
import { ChapterDetailPanel } from "../../../components/domains/chapters/chapter-detail-panel";
import { ChapterForm } from "../../../components/domains/chapters/chapter-form";
import { QuickChapterImagesDialog } from "../../../components/domains/chapters/quick-chapter-images-dialog";
import { errorMessage } from "../../../components/domains/feedback";
import { PageHeader } from "../../../components/layout/page-header";
import { AppDialog } from "../../../components/ui/app-dialog";
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
import { StatusBadge } from "../../../components/ui/status-badge";
import { hasCapability } from "../../../lib/auth/visibility";
import {
  useChapter,
  useChapterCapabilities,
  useCreateChapter,
  useDeleteChapter,
  useGlobalChapterList,
  useUpdateChapter,
} from "../../../lib/domains/chapters/hooks";
import {
  type ChapterStatus,
  chapterStatuses,
} from "../../../lib/domains/chapters/types";
import { usePublicChapter } from "../../../lib/domains/publication/hooks";
import { sortPublicImages } from "../../../lib/domains/publication/utils";

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
  const quickChapter = useMemo(
    () =>
      (chapters.data ?? []).find((chapter) => chapter.id === quickChapterId) ??
      null,
    [chapters.data, quickChapterId],
  );
  const selectedQuery = useChapter(selectedChapterId ?? "");
  const selectedCapabilities = useChapterCapabilities(selectedChapterId ?? "");
  const create = useCreateChapter(selectedChapter?.series.id ?? "");
  const update = useUpdateChapter(
    selectedChapterId ?? "",
    selectedChapter?.series.id ?? "",
  );
  const remove = useDeleteChapter(selectedChapter?.series.id ?? "");
  const publicChapter = usePublicChapter(
    selectedChapterId ?? "",
    Boolean(selectedChapterId),
  );
  const canCreate = hasCapability(
    selectedCapabilities.data?.capabilities,
    "chapters.create",
  );
  const canUpload = hasCapability(
    selectedCapabilities.data?.capabilities,
    "images.upload",
  );
  const canAssignCollaborator = hasCapability(
    selectedCapabilities.data?.capabilities,
    "chapters.helper.grant",
  );

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
  const previewImages = sortPublicImages(
    publicChapter.data?.images ?? [],
  ).slice(0, 5);
  const remainingImages = Math.max(
    0,
    (publicChapter.data?.images.length ?? 0) - previewImages.length,
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
        title="Capítulos"
        description="Consulta los capítulos disponibles en tus series."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Capítulos", current: true },
        ]}
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
              <select
                aria-label="Serie"
                className="h-control-lg w-44 shrink-0 rounded-lg border border-border bg-surface px-3 text-sm text-text"
                value={seriesId}
                onChange={(event) => {
                  setSeriesId(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Serie: Todas</option>
                {seriesOptions.map((series) => (
                  <option key={series.id} value={series.id}>
                    {series.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Estado"
                className="h-control-lg w-36 shrink-0 rounded-lg border border-border bg-surface px-3 text-sm text-text"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as ChapterStatus | "all");
                  setPage(1);
                }}
              >
                <option value="all">Estado: Todos</option>
                {chapterStatuses.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </Card>
            <DataTable
              label="Capítulos globales"
              minHeightClassName="lg:min-h-[700px]"
            >
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="p-3">Portada</th>
                  <th className="p-3">Serie</th>
                  <th className="p-3">Capítulo</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Imágenes</th>
                  <th className="p-3">Última actualización</th>
                  <th className="p-3">Responsable</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.length === 0 ? (
                  <DataTableEmptyRow
                    colSpan={8}
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
                        <td className="min-w-[14rem] p-0 font-medium">
                          <button
                            aria-pressed={selected}
                            className="w-full px-3 py-3 text-left text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                            type="button"
                            onClick={(event) => {
                              stopTableRowSelection(event);
                              selectChapter(chapter.id);
                            }}
                          >
                            <span className="line-clamp-2 font-semibold text-primary">
                              {chapter.series.title}
                            </span>
                            <span className="block max-w-[18rem] truncate text-xs text-muted">
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
                        <td className="p-3 text-muted">—</td>
                        <td className="whitespace-nowrap p-3 text-muted">
                          {new Date(chapter.updatedAt).toLocaleDateString(
                            "es-PE",
                          )}
                        </td>
                        <td className="p-3 text-muted">—</td>
                        <td className="p-3">
                          <div className="flex justify-end gap-2">
                            <Link
                              aria-label={`Gestionar capítulo ${chapter.chapterNumber}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-border bg-surface-elevated text-secondary hover:text-text"
                              href={`/series/${chapter.series.id}/chapters/${chapter.id}/images`}
                              title="Gestionar capítulo"
                              onClick={stopTableRowSelection}
                            >
                              <Images aria-hidden="true" className="size-4" />
                            </Link>
                            <button
                              aria-label={`Imágenes del capítulo ${chapter.chapterNumber}`}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-control border border-border bg-surface-elevated text-secondary hover:text-text"
                              title="Imágenes"
                              type="button"
                              onClick={(event) => {
                                stopTableRowSelection(event);
                                selectChapter(chapter.id);
                                setQuickChapterId(chapter.id);
                              }}
                            >
                              <ListPlus aria-hidden="true" className="size-4" />
                            </button>
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
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Card className="h-52 overflow-y-auto p-4">
                <h2 className="m-0 text-sm font-semibold">ACCIONES RÁPIDAS</h2>
                <div className="mt-3 grid gap-2 text-sm">
                  {canCreate ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCreating(true)}
                    >
                      <Plus aria-hidden="true" className="size-4" /> Crear
                      capítulo
                    </Button>
                  ) : null}
                  {canUpload ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setUploading(true)}
                    >
                      <Upload aria-hidden="true" className="size-4" /> Subir
                      capítulos
                    </Button>
                  ) : null}
                  {canAssignCollaborator ? (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setAssigning(true)}
                    >
                      <UserRoundPlus aria-hidden="true" className="size-4" />{" "}
                      Asignar colaborador
                    </Button>
                  ) : null}
                </div>
              </Card>
              <Card className="h-52 overflow-y-auto p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="m-0 text-sm font-semibold">
                    IMÁGENES DEL CAPÍTULO
                  </h2>
                  {selectedChapter ? (
                    <button
                      className="text-sm font-medium text-primary"
                      type="button"
                      onClick={() => setQuickChapterId(selectedChapter.id)}
                    >
                      Ver todas
                    </button>
                  ) : null}
                </div>
                {publicChapter.isPending ? (
                  <p className="mt-3 text-sm text-muted">Cargando imágenes…</p>
                ) : null}
                {!publicChapter.isPending && !previewImages.length ? (
                  <p className="mt-3 text-sm text-muted">
                    No hay imágenes publicadas.
                  </p>
                ) : null}
                <div className="mt-3 grid gap-2">
                  {previewImages.map((image) => (
                    <div
                      className="flex items-center gap-2 text-sm"
                      key={image.id}
                    >
                      <ContentImage
                        alt={image.filename}
                        src={image.url}
                        variant="thumbnail"
                      />
                      <span className="min-w-0 truncate">{image.filename}</span>
                    </div>
                  ))}
                </div>
                {remainingImages > 0 && selectedChapter ? (
                  <button
                    className="mt-3 text-sm font-medium text-primary"
                    type="button"
                    onClick={() => setQuickChapterId(selectedChapter.id)}
                  >
                    +{remainingImages} imágenes más
                  </button>
                ) : null}
              </Card>
              <Card className="h-52 overflow-y-auto p-4">
                <h2 className="m-0 text-sm font-semibold">
                  ACTIVIDAD RECIENTE
                </h2>
                <div className="grid place-items-center gap-2 py-8 text-center text-sm text-muted">
                  <Clock3 aria-hidden="true" className="size-5" />
                  <span className="font-medium">Sin actividad reciente</span>
                  <span>No hay actividad para mostrar.</span>
                </div>
              </Card>
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
                capabilities={selectedCapabilities.data?.capabilities}
                showMetricsPlaceholder
                onClose={() => setSelectedChapterId(null)}
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
      {selectedChapter ? (
        <>
          <AppDialog
            open={creating}
            title="Crear capítulo"
            onOpenChange={setCreating}
            busy={create.isPending}
          >
            <ChapterForm
              submitLabel="Crear capítulo"
              onSubmit={async (input) => {
                const chapter = await create.mutateAsync(input);
                setCreating(false);
                selectChapter(chapter.id);
              }}
              onCancel={() => setCreating(false)}
            />
          </AppDialog>
          <BulkChapterUploadDialog
            open={uploading}
            onOpenChange={setUploading}
            seriesId={selectedChapter.series.id}
            seriesTitle={selectedChapter.series.title}
          />
          <AssignChapterCollaboratorDialog
            chapterId={selectedChapter.id}
            chapterNumber={selectedChapter.chapterNumber}
            open={assigning}
            onClose={() => setAssigning(false)}
          />
        </>
      ) : null}
      {quickChapter ? (
        <QuickChapterImagesDialog
          open
          onClose={() => setQuickChapterId(null)}
          seriesId={quickChapter.series.id}
          seriesTitle={quickChapter.series.title}
          chapterId={quickChapter.id}
          chapterNumber={quickChapter.chapterNumber}
        />
      ) : null}
    </>
  );
}
