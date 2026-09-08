"use client";

import { Clock3, List, Plus } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "../../../components/domains/feedback";
import { SeriesContextPanel } from "../../../components/domains/series/series-context-panel";
import { SeriesDetailPanel } from "../../../components/domains/series/series-detail-panel";
import { SeriesForm } from "../../../components/domains/series/series-form";
import { SeriesList } from "../../../components/domains/series/series-list";
import { PageHeader } from "../../../components/layout/page-header";
import { AppDialog } from "../../../components/ui/app-dialog";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { LoadingState } from "../../../components/ui/loading-state";
import { Pagination } from "../../../components/ui/pagination";
import { SearchInput } from "../../../components/ui/search-input";
import { hasCapability } from "../../../lib/auth/visibility";
import { useCapabilities } from "../../../lib/domains/auth/hooks";
import { useChapterList } from "../../../lib/domains/chapters/hooks";
import {
  useAssignSeriesUploader,
  useClearSeriesUploader,
  useCreateSeries,
  useDeleteSeries,
  useSeries,
  useSeriesCapabilities,
  useSeriesList,
  useSeriesUploaderCandidates,
  useUpdateSeries,
} from "../../../lib/domains/series/hooks";
import type { SeriesInput } from "../../../lib/domains/series/types";
import {
  filterSeries,
  toSeriesListItem,
} from "../../../lib/domains/series/view-model";

const pageSize = 10;

export default function SeriesPage() {
  const listQuery = useSeriesList();
  const globalCapabilities = useCapabilities();
  const create = useCreateSeries();
  const remove = useDeleteSeries();
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const didInitializeSelection = useRef(false);
  const [query, setQuery] = useState("");
  const [responsible, setResponsible] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedQuery = useSeries(selectedSeriesId ?? "");
  const contextualChaptersQuery = useChapterList(selectedSeriesId ?? "");
  const selectedCapabilities = useSeriesCapabilities(selectedSeriesId ?? "");
  const update = useUpdateSeries(selectedSeriesId ?? "");
  const canManageAssignment = hasCapability(
    selectedCapabilities.data?.capabilities,
    "series.assignment.manage",
  );
  const uploaderCandidates = useSeriesUploaderCandidates(
    selectedSeriesId ?? "",
    canManageAssignment,
  );
  const assignUploader = useAssignSeriesUploader(selectedSeriesId ?? "");
  const clearUploader = useClearSeriesUploader(selectedSeriesId ?? "");
  const canCreate = hasCapability(
    globalCapabilities.data?.capabilities,
    "series.create",
  );
  const canViewChapters = hasCapability(
    selectedCapabilities.data?.capabilities,
    "series.read",
  );

  const items = useMemo(() => {
    const filtered = filterSeries(listQuery.data ?? [], query).filter(
      (series) =>
        !responsible || series.principalUploader?.email === responsible,
    );
    return filtered.map(toSeriesListItem);
  }, [listQuery.data, query, responsible]);
  const responsibleOptions = useMemo(
    () =>
      [
        ...new Set(
          (listQuery.data ?? []).flatMap((item) =>
            item.principalUploader?.email ? [item.principalUploader.email] : [],
          ),
        ),
      ].sort(),
    [listQuery.data],
  );

  useEffect(() => {
    if (didInitializeSelection.current || !listQuery.data?.length) return;

    const initialSeriesId = listQuery.data.find((series) => series.id)?.id;
    if (!initialSeriesId) return;

    didInitializeSelection.current = true;
    setSelectedSeriesId(initialSeriesId);
  }, [listQuery.data]);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = items.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  async function handleCreate(input: SeriesInput) {
    await create.mutateAsync(input);
    setCreating(false);
  }

  async function handleDelete() {
    if (!selectedSeriesId) return;
    setActionError(null);
    try {
      await remove.mutateAsync(selectedSeriesId);
      setSelectedSeriesId(null);
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  }

  function selectSeries(seriesId: string) {
    setActionError(null);
    setSelectedSeriesId(seriesId);
  }

  return (
    <>
      <PageHeader
        title="Series"
        description="Gestiona las series de la plataforma."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Series", current: true },
        ]}
        actions={
          canCreate ? (
            <Button
              type="button"
              onClick={() => setCreating((value) => !value)}
            >
              <Plus aria-hidden="true" className="size-4" />
              {creating ? "Cerrar" : "Nueva serie"}
            </Button>
          ) : undefined
        }
      />
      <AppDialog open={creating} title="Nueva serie" onOpenChange={setCreating}>
        <SeriesForm
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
        />
      </AppDialog>
      {actionError ? (
        <p className="mb-section text-sm text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      {listQuery.isPending ? <LoadingState label="Cargando Series" /> : null}
      {listQuery.isError ? (
        <ErrorState
          title="No se pudieron cargar las Series"
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
          title="No hay Series todavía"
          description="Crea la primera Series cuando tengas autorización para hacerlo."
        />
      ) : null}
      {listQuery.isSuccess && listQuery.data.length > 0 ? (
        <section className="grid min-h-0 gap-card xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] xl:items-stretch">
          <main className="flex min-w-0 flex-col">
            <Card className="mb-4 flex flex-wrap items-center gap-2 p-3 lg:flex-nowrap">
              <div className="w-full max-w-xs shrink">
                <SearchInput
                  placeholder="Buscar series..."
                  value={query}
                  onChange={(value) => {
                    setQuery(value);
                    setPage(1);
                  }}
                />
              </div>
              <select
                aria-label="Estado"
                className="h-control-lg w-36 shrink-0 rounded-lg border border-border bg-surface px-3 text-sm text-text"
                value="active"
                onChange={() => undefined}
              >
                <option value="active">Estado: Activa</option>
              </select>
              <select
                aria-label="Responsable"
                className="h-control-lg w-48 shrink-0 rounded-lg border border-border bg-surface px-3 text-sm text-text"
                value={responsible}
                onChange={(event) => {
                  setResponsible(event.target.value);
                  setPage(1);
                }}
              >
                <option value="">Responsable: Todos</option>
                {responsibleOptions.map((email) => (
                  <option key={email} value={email}>
                    {email}
                  </option>
                ))}
              </select>
            </Card>
            <SeriesList
              items={pageItems}
              selectedId={selectedSeriesId}
              minTableHeightClassName="lg:min-h-[700px]"
              onSelect={selectSeries}
            />
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
                      <Plus aria-hidden="true" className="size-4" /> Nueva serie
                    </Button>
                  ) : null}
                  {selectedSeriesId && canViewChapters ? (
                    <Link
                      className="inline-flex min-h-control items-center justify-center gap-2 rounded-control border border-border bg-surface px-3.5 font-medium text-text hover:bg-surface-hover"
                      href={`/series/${selectedSeriesId}/chapters`}
                    >
                      <List aria-hidden="true" className="size-4" />
                      Gestionar capítulos
                    </Link>
                  ) : (
                    <span className="text-muted">
                      Selecciona una serie para ver acciones.
                    </span>
                  )}
                </div>
              </Card>
              <Card className="h-52 overflow-y-auto p-4">
                <h2 className="m-0 text-sm font-semibold">
                  CHAPTERS RECIENTES
                </h2>
                {!selectedSeriesId ? (
                  <p className="mb-0 mt-3 text-sm text-muted">
                    Selecciona una serie.
                  </p>
                ) : null}
                {selectedSeriesId && contextualChaptersQuery.isPending ? (
                  <p className="mb-0 mt-3 text-sm text-muted">
                    Cargando Chapters…
                  </p>
                ) : null}
                {selectedSeriesId &&
                !contextualChaptersQuery.isPending &&
                !contextualChaptersQuery.data?.length ? (
                  <p className="mb-0 mt-3 text-sm text-muted">
                    No hay Chapters todavía.
                  </p>
                ) : null}
                {contextualChaptersQuery.data?.slice(0, 5).map((chapter) => (
                  <p className="mb-0 mt-2 text-sm text-muted" key={chapter.id}>
                    Capítulo {chapter.chapterNumber} · {chapter.status}
                  </p>
                ))}
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
          <SeriesContextPanel open={Boolean(selectedSeriesId)}>
            {selectedSeriesId && selectedQuery.isPending ? (
              <LoadingState label="Cargando detalle de la serie" />
            ) : null}
            {selectedSeriesId && selectedQuery.isError ? (
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
            {!selectedSeriesId || selectedQuery.isSuccess ? (
              <SeriesDetailPanel
                series={selectedQuery.data ?? null}
                capabilities={selectedCapabilities.data?.capabilities}
                onClose={() => setSelectedSeriesId(null)}
                onUpdate={async (input) => {
                  if (!selectedSeriesId) return;
                  await update.mutateAsync(input);
                }}
                onDelete={handleDelete}
                candidates={uploaderCandidates.data}
                candidatesLoading={uploaderCandidates.isPending}
                candidatesError={
                  uploaderCandidates.error instanceof Error
                    ? uploaderCandidates.error
                    : null
                }
                assignmentPending={
                  assignUploader.isPending || clearUploader.isPending
                }
                updatePending={update.isPending}
                deletePending={remove.isPending}
                onAssignUploader={async (uploaderId) =>
                  assignUploader.mutateAsync(uploaderId)
                }
                onClearUploader={async () => clearUploader.mutateAsync()}
              />
            ) : null}
          </SeriesContextPanel>
        </section>
      ) : null}
    </>
  );
}
