"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Plus, Upload } from "lucide-react";
import { errorMessage } from "../../../../../components/domains/feedback";
import { ChapterDetailPanel } from "../../../../../components/domains/chapters/chapter-detail-panel";
import { ChapterForm } from "../../../../../components/domains/chapters/chapter-form";
import { ChapterList } from "../../../../../components/domains/chapters/chapter-list";
import { QuickChapterImagesDialog } from "../../../../../components/domains/chapters/quick-chapter-images-dialog";
import { BulkChapterUploadDialog } from "../../../../../components/domains/chapters/bulk-chapter-upload-dialog";
import { PageHeader } from "../../../../../components/layout/page-header";
import { Button } from "../../../../../components/ui/button";
import { AppDialog } from "../../../../../components/ui/app-dialog";
import { Card } from "../../../../../components/ui/card";
import { EmptyState } from "../../../../../components/ui/empty-state";
import { ErrorState } from "../../../../../components/ui/error-state";
import { LoadingState } from "../../../../../components/ui/loading-state";
import { PageSection } from "../../../../../components/ui/page-section";
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
  filterChapters,
  sortChapters,
  toChapterListItem,
} from "../../../../../lib/domains/chapters/view-model";
import {
  useSeries,
  useSeriesCapabilities,
} from "../../../../../lib/domains/series/hooks";

export default function SeriesChaptersPage() {
  const params = useParams<{ seriesId: string }>();
  const seriesId = params.seriesId;
  const seriesQuery = useSeries(seriesId);
  const seriesCapabilities = useSeriesCapabilities(seriesId);
  const listQuery = useChapterList(seriesId);
  const create = useCreateChapter(seriesId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [quickChapter, setQuickChapter] = useState<{
    id: string;
    chapterNumber: number;
  } | null>(null);
  const [uploadDialog, setUploadDialog] = useState(false);
  const selectedQuery = useChapter(selectedId ?? "");
  const selectedCapabilities = useChapterCapabilities(selectedId ?? "");
  const update = useUpdateChapter(selectedId ?? "", seriesId);
  const remove = useDeleteChapter(seriesId);

  const items = useMemo(
    () =>
      filterChapters(sortChapters(listQuery.data ?? []), query).map(
        toChapterListItem,
      ),
    [listQuery.data, query],
  );
  const canCreate = hasCapability(
    seriesCapabilities.data?.capabilities,
    "chapters.create",
  );

  async function handleDelete() {
    if (!selectedId) return;
    setActionError(null);
    try {
      await remove.mutateAsync(selectedId);
      setSelectedId(null);
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
          <div className="flex flex-wrap gap-2">
            {canCreate ? (
              <Button
                className="border-border bg-surface text-text hover:bg-surface-hover"
                type="button"
                onClick={() => setUploadDialog(true)}
              >
                <Upload aria-hidden="true" className="size-4" /> Subir capítulo
              </Button>
            ) : null}
            {canCreate ? (
              <Button type="button" onClick={() => setCreating(true)}>
                <Plus aria-hidden="true" className="size-4" /> Nuevo capítulo
              </Button>
            ) : null}
          </div>
        }
      />
      <AppDialog
        busy={create.isPending}
        description="El número puede ser arbitrario y no necesita ser consecutivo. La unicidad se valida en el backend."
        open={creating}
        title="Nuevo capítulo"
        onOpenChange={setCreating}
      >
        <ChapterForm
          onSubmit={async (input) => {
            const chapter = await create.mutateAsync(input);
            setCreating(false);
            setSelectedId(chapter.id);
          }}
          onCancel={() => setCreating(false)}
        />
      </AppDialog>
      <PageSection>
        <Card className="p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar por número, clave o título"
          />
        </Card>
      </PageSection>
      {actionError ? (
        <p className="mb-section text-sm text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      {listQuery.isPending ? <LoadingState label="Cargando Chapters" /> : null}
      {listQuery.isError ? (
        <ErrorState
          title="No se pudieron cargar los Chapters"
          description={errorMessage(listQuery.error)}
          action={
            <Button type="button" onClick={() => void listQuery.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : null}
      {listQuery.isSuccess && listQuery.data.length === 0 ? (
        <EmptyState
          title="No hay capítulos en esta serie"
          description="Crea un capítulo cuando tengas autorización para hacerlo."
        />
      ) : null}
      {listQuery.isSuccess && listQuery.data.length > 0 ? (
        <section className="grid min-h-0 items-start gap-card xl:grid-cols-[minmax(0,3fr)_minmax(320px,1fr)]">
          <div>
            {items.length ? (
              <ChapterList
                items={items}
                selectedId={selectedId}
                onSelect={(chapterId) => {
                  setActionError(null);
                  setSelectedId(chapterId);
                }}
                onQuickImages={(chapter) =>
                  setQuickChapter({
                    id: chapter.id,
                    chapterNumber: chapter.chapterNumber,
                  })
                }
              />
            ) : (
              <EmptyState
                title="Sin coincidencias"
                description="No hay Chapters que coincidan con la búsqueda actual."
              />
            )}
          </div>
          <aside aria-label="Detalle del capítulo" className="min-h-0">
            {selectedId && selectedQuery.isPending ? (
              <LoadingState label="Cargando detalle del Chapter" />
            ) : null}
            {selectedId && selectedQuery.isError ? (
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
            {!selectedId || selectedQuery.isSuccess ? (
              <ChapterDetailPanel
                chapter={selectedQuery.data ?? null}
                capabilities={selectedCapabilities.data?.capabilities}
                onClose={() => setSelectedId(null)}
                onUpdate={async (input) => {
                  if (!selectedId) return;
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
      <BulkChapterUploadDialog
        open={uploadDialog}
        onOpenChange={setUploadDialog}
        seriesId={seriesId}
        seriesTitle={seriesQuery.data?.title ?? "esta serie"}
      />
      {quickChapter ? (
        <QuickChapterImagesDialog
          open
          onClose={() => setQuickChapter(null)}
          seriesId={seriesId}
          seriesTitle={seriesQuery.data?.title ?? "Serie"}
          chapterId={quickChapter.id}
          chapterNumber={quickChapter.chapterNumber}
        />
      ) : null}
    </>
  );
}
