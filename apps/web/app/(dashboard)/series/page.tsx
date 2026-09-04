"use client";

import { useMemo, useState } from "react";
import { errorMessage } from "../../../components/domains/feedback";
import { SeriesContextPanel } from "../../../components/domains/series/series-context-panel";
import { SeriesDetailPanel } from "../../../components/domains/series/series-detail-panel";
import { SeriesForm } from "../../../components/domains/series/series-form";
import { SeriesList } from "../../../components/domains/series/series-list";
import { PageHeader } from "../../../components/layout/page-header";
import { Button } from "../../../components/ui/button";
import { Card } from "../../../components/ui/card";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { LoadingState } from "../../../components/ui/loading-state";
import { PageSection } from "../../../components/ui/page-section";
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

export default function SeriesPage() {
  const listQuery = useSeriesList();
  const globalCapabilities = useCapabilities();
  const create = useCreateSeries();
  const remove = useDeleteSeries();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedQuery = useSeries(selectedId ?? "");
  const contextualChaptersQuery = useChapterList(selectedId ?? "");
  const selectedCapabilities = useSeriesCapabilities(selectedId ?? "");
  const update = useUpdateSeries(selectedId ?? "");
  const canManageAssignment = hasCapability(
    selectedCapabilities.data?.capabilities,
    "series.assignment.manage",
  );
  const uploaderCandidates = useSeriesUploaderCandidates(
    selectedId ?? "",
    canManageAssignment,
  );
  const assignUploader = useAssignSeriesUploader(selectedId ?? "");
  const clearUploader = useClearSeriesUploader(selectedId ?? "");

  const items = useMemo(
    () => filterSeries(listQuery.data ?? [], query).map(toSeriesListItem),
    [listQuery.data, query],
  );
  const canCreate = hasCapability(
    globalCapabilities.data?.capabilities,
    "series.create",
  );

  async function handleCreate(input: SeriesInput) {
    await create.mutateAsync(input);
    setCreating(false);
  }

  async function handleDelete() {
    if (!selectedId) return;
    setActionError(null);
    try {
      await remove.mutateAsync(selectedId);
      setSelectedId(null);
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
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
              {creating ? "Cerrar" : "Nueva serie"}
            </Button>
          ) : undefined
        }
      />
      {creating ? (
        <PageSection>
          <Card aria-labelledby="create-series-title">
            <h2
              id="create-series-title"
              className="mb-4 mt-0 text-xl font-semibold"
            >
              Nueva serie
            </h2>
            <SeriesForm
              onSubmit={handleCreate}
              onCancel={() => setCreating(false)}
            />
          </Card>
        </PageSection>
      ) : null}
      <PageSection>
        <Card className="p-3">
          <SearchInput
            value={query}
            onChange={setQuery}
            placeholder="Buscar por nombre o slug"
          />
        </Card>
      </PageSection>
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
        <section className="grid min-h-0 items-start gap-card xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.38fr)]">
          <div>
            {items.length ? (
              <SeriesList
                items={items}
                selectedId={selectedId}
                onSelect={(seriesId) => {
                  setActionError(null);
                  setSelectedId(seriesId);
                }}
              />
            ) : (
              <EmptyState
                title="Sin coincidencias"
                description="No hay Series que coincidan con la búsqueda actual."
              />
            )}
          </div>
          <SeriesContextPanel open={Boolean(selectedId)}>
            {selectedId && selectedQuery.isPending ? (
              <LoadingState label="Cargando detalle de la Series" />
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
              <SeriesDetailPanel
                series={selectedQuery.data ?? null}
                capabilities={selectedCapabilities.data?.capabilities}
                onClose={() => setSelectedId(null)}
                onUpdate={async (input) => {
                  if (!selectedId) return;
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
                chapters={contextualChaptersQuery.data ?? []}
                chaptersLoading={contextualChaptersQuery.isPending}
                assignmentPending={
                  assignUploader.isPending || clearUploader.isPending
                }
                updatePending={update.isPending}
                deletePending={remove.isPending}
                onAssignUploader={async (uploaderId) => {
                  await assignUploader.mutateAsync(uploaderId);
                }}
                onClearUploader={async () => {
                  await clearUploader.mutateAsync();
                }}
              />
            ) : null}
          </SeriesContextPanel>
        </section>
      ) : null}
    </>
  );
}
