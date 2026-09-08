"use client";

import { Clock3, Plus, Upload, UserRoundPlus } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AssignChapterCollaboratorDialog } from "../../../../../components/domains/chapters/assign-chapter-collaborator-dialog";
import { BulkChapterUploadDialog } from "../../../../../components/domains/chapters/bulk-chapter-upload-dialog";
import { ChapterDetailPanel } from "../../../../../components/domains/chapters/chapter-detail-panel";
import { ChapterForm } from "../../../../../components/domains/chapters/chapter-form";
import { ChapterList } from "../../../../../components/domains/chapters/chapter-list";
import { QuickChapterImagesDialog } from "../../../../../components/domains/chapters/quick-chapter-images-dialog";
import { errorMessage } from "../../../../../components/domains/feedback";
import { PageHeader } from "../../../../../components/layout/page-header";
import { AppDialog } from "../../../../../components/ui/app-dialog";
import { Button } from "../../../../../components/ui/button";
import { Card } from "../../../../../components/ui/card";
import { ContentImage } from "../../../../../components/ui/content-image";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { ErrorState } from "../../../../../components/ui/error-state";
import { LoadingState } from "../../../../../components/ui/loading-state";
import { Pagination } from "../../../../../components/ui/pagination";
import { SearchInput } from "../../../../../components/ui/search-input";
import { hasCapability } from "../../../../../lib/auth/visibility";
import {
  useChapter,
  useChapterCapabilities,
  useChapterList,
  useCreateChapter,
  useDeleteChapter,
  useUpdateChapter,
} from "../../../../../lib/domains/chapters/hooks";
import {
  type ChapterStatus,
  chapterStatuses,
} from "../../../../../lib/domains/chapters/types";
import {
  filterChapters,
  sortChapters,
  toChapterListItem,
} from "../../../../../lib/domains/chapters/view-model";
import { usePublicChapter } from "../../../../../lib/domains/publication/hooks";
import { sortPublicImages } from "../../../../../lib/domains/publication/utils";
import {
  useSeries,
  useSeriesCapabilities,
} from "../../../../../lib/domains/series/hooks";

const pageSize = 10;

export default function SeriesChaptersPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const seriesQuery = useSeries(seriesId);
  const seriesCapabilities = useSeriesCapabilities(seriesId);
  const listQuery = useChapterList(seriesId);
  const create = useCreateChapter(seriesId);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(
    null,
  );
  const didInitializeSelection = useRef(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ChapterStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [quickChapterId, setQuickChapterId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedQuery = useChapter(selectedChapterId ?? "");
  const selectedCapabilities = useChapterCapabilities(selectedChapterId ?? "");
  const update = useUpdateChapter(selectedChapterId ?? "", seriesId);
  const remove = useDeleteChapter(seriesId);
  const publicChapter = usePublicChapter(
    selectedChapterId ?? "",
    Boolean(selectedChapterId),
  );
  const canCreate = hasCapability(
    seriesCapabilities.data?.capabilities,
    "chapters.create",
  );
  const canUpload = hasCapability(
    seriesCapabilities.data?.capabilities,
    "images.upload",
  );
  const canAssign = hasCapability(
    selectedCapabilities.data?.capabilities,
    "chapters.helper.grant",
  );

  useEffect(() => {
    if (didInitializeSelection.current || !listQuery.data?.length) return;
    const initialChapterId = listQuery.data.find((chapter) => chapter.id)?.id;
    if (!initialChapterId) return;
    didInitializeSelection.current = true;
    setSelectedChapterId(initialChapterId);
  }, [listQuery.data]);

  const allItems = useMemo(
    () =>
      filterChapters(sortChapters(listQuery.data ?? []), query)
        .map(toChapterListItem)
        .filter((chapter) => status === "all" || chapter.status === status),
    [listQuery.data, query, status],
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(allItems.length / pageSize)),
  );
  const items = allItems.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const selectedListItem = useMemo(
    () =>
      (listQuery.data ?? []).find(
        (chapter) => chapter.id === selectedChapterId,
      ) ?? null,
    [listQuery.data, selectedChapterId],
  );
  const quickChapter = useMemo(
    () =>
      (listQuery.data ?? []).find((chapter) => chapter.id === quickChapterId) ??
      null,
    [listQuery.data, quickChapterId],
  );
  const previews = sortPublicImages(publicChapter.data?.images ?? []).slice(
    0,
    5,
  );
  const remainingImages = Math.max(
    0,
    (publicChapter.data?.images.length ?? 0) - previews.length,
  );

  async function handleDelete() {
    if (!selectedChapterId) return;
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
        description={
          seriesQuery.data?.title
            ? `Gestiona los capítulos de ${seriesQuery.data.title}.`
            : "Gestiona los capítulos de esta serie."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Series", href: "/series" },
          { label: seriesQuery.data?.title ?? "Serie", current: true },
        ]}
        back={{ label: "Volver a Series", href: "/series" }}
        actions={
          <div className="flex flex-nowrap items-center gap-2">
            {canUpload ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setUploading(true)}
              >
                <Upload aria-hidden="true" className="size-4" />
                Subir capítulo
              </Button>
            ) : null}
            {canCreate ? (
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" className="size-4" />
                Nuevo capítulo
              </Button>
            ) : null}
          </div>
        }
      />
      <AppDialog
        open={creating}
        title="Crear capítulo"
        busy={create.isPending}
        onOpenChange={setCreating}
      >
        <ChapterForm
          submitLabel="Crear capítulo"
          onSubmit={async (input) => {
            const chapter = await create.mutateAsync(input);
            setCreating(false);
            setSelectedChapterId(chapter.id);
          }}
          onCancel={() => setCreating(false)}
        />
      </AppDialog>
      {actionError ? (
        <p className="mb-section text-sm text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      {listQuery.isPending ? <LoadingState label="Cargando capítulos" /> : null}
      {listQuery.isError ? (
        <ErrorState
          title="No se pudieron cargar los capítulos"
          description={errorMessage(listQuery.error)}
          action={
            <Button type="button" onClick={() => void listQuery.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : null}
      {listQuery.isSuccess && !listQuery.data.length ? (
        <EmptyState
          title="No hay capítulos en esta serie"
          description="Crea un capítulo cuando tengas autorización para hacerlo."
        />
      ) : null}
      {listQuery.isSuccess && listQuery.data.length ? (
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
              <select
                aria-label="Responsable"
                className="h-control-lg w-48 shrink-0 rounded-lg border border-border bg-surface px-3 text-sm text-text"
                disabled
              >
                <option>Responsable: No disponible</option>
              </select>
            </Card>
            <ChapterList
              items={items}
              selectedId={selectedChapterId}
              minTableHeightClassName="lg:min-h-[700px]"
              onSelect={(chapterId) => {
                setActionError(null);
                setSelectedChapterId(chapterId);
              }}
              onQuickImages={(chapter) => setQuickChapterId(chapter.id)}
            />
            <div className="mt-3">
              <Pagination
                page={currentPage}
                totalPages={Math.max(1, Math.ceil(allItems.length / pageSize))}
                totalItems={allItems.length}
                onPrevious={() => setPage((current) => current - 1)}
                onNext={() => setPage((current) => current + 1)}
              />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Card className="h-52 overflow-y-auto p-4">
                <h2 className="m-0 text-sm font-semibold">ACCIONES RÁPIDAS</h2>
                <div className="mt-3 grid gap-2">
                  {canCreate ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => setCreating(true)}
                    >
                      <Plus aria-hidden="true" className="size-4" /> Crear
                      capítulo
                    </Button>
                  ) : null}
                  {canUpload ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => setUploading(true)}
                    >
                      <Upload aria-hidden="true" className="size-4" /> Subir
                      capítulos
                    </Button>
                  ) : null}
                  {canAssign ? (
                    <Button
                      variant="secondary"
                      type="button"
                      onClick={() => setAssigning(true)}
                    >
                      <UserRoundPlus aria-hidden="true" className="size-4" />{" "}
                      Asignar colaborador
                    </Button>
                  ) : null}
                </div>
              </Card>
              <Card className="h-52 overflow-y-auto p-4">
                <div className="flex items-center justify-between">
                  <h2 className="m-0 text-sm font-semibold">
                    IMÁGENES DEL CAPÍTULO
                  </h2>
                  {selectedListItem ? (
                    <button
                      className="text-sm font-medium text-primary"
                      type="button"
                      onClick={() => setQuickChapterId(selectedListItem.id)}
                    >
                      Ver todas
                    </button>
                  ) : null}
                </div>
                {publicChapter.isPending ? (
                  <p className="text-sm text-muted">Cargando imágenes…</p>
                ) : null}
                <div className="mt-3 grid gap-2">
                  {previews.map((image) => (
                    <div
                      className="flex items-center gap-2 text-sm"
                      key={image.id}
                    >
                      <ContentImage
                        alt={image.filename}
                        src={image.url}
                        variant="thumbnail"
                      />
                      <span className="truncate">{image.filename}</span>
                    </div>
                  ))}
                </div>
                {remainingImages > 0 ? (
                  <button
                    className="mt-3 text-sm font-medium text-primary"
                    type="button"
                    onClick={() =>
                      selectedListItem && setQuickChapterId(selectedListItem.id)
                    }
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
              />
            ) : null}
            {!selectedChapterId || selectedQuery.isSuccess ? (
              <ChapterDetailPanel
                chapter={selectedQuery.data ?? null}
                capabilities={selectedCapabilities.data?.capabilities}
                seriesTitle={seriesQuery.data?.title ?? "Serie"}
                showMetricsPlaceholder
                onClose={() => setSelectedChapterId(null)}
                onUpdate={async (input) => {
                  if (selectedChapterId) await update.mutateAsync(input);
                }}
                onDelete={handleDelete}
                updatePending={update.isPending}
                deletePending={remove.isPending}
              />
            ) : null}
          </aside>
        </section>
      ) : null}
      <BulkChapterUploadDialog
        open={uploading}
        onOpenChange={setUploading}
        seriesId={seriesId}
        seriesTitle={seriesQuery.data?.title ?? "esta serie"}
      />
      {selectedListItem ? (
        <AssignChapterCollaboratorDialog
          chapterId={selectedListItem.id}
          chapterNumber={selectedListItem.chapterNumber}
          open={assigning}
          onClose={() => setAssigning(false)}
        />
      ) : null}
      {quickChapter ? (
        <QuickChapterImagesDialog
          open
          onClose={() => setQuickChapterId(null)}
          seriesId={seriesId}
          seriesTitle={seriesQuery.data?.title ?? "Serie"}
          chapterId={quickChapter.id}
          chapterNumber={quickChapter.chapterNumber}
        />
      ) : null}
    </>
  );
}
