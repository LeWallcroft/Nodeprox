"use client";

import { Plus } from "lucide-react";
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
import { useAvailableSeriesCreationGrants } from "../../../lib/domains/authorizations/hooks";
import { requiresSeriesCreationGrant } from "../../../lib/domains/series/creation-policy";
import {
  useAssignSeriesResponsible,
  useCreateSeries,
  useDeleteSeries,
  useSelectableSeriesChannels,
  useSeries,
  useSeriesCapabilities,
  useSeriesList,
  useSeriesResponsibleCandidates,
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
  const selectedCapabilities = useSeriesCapabilities(selectedSeriesId ?? "");
  const update = useUpdateSeries(selectedSeriesId ?? "");
  const canManageAssignment = hasCapability(
    selectedCapabilities.data?.capabilities,
    "series.assignment.manage",
  );
  const responsibleCandidates = useSeriesResponsibleCandidates(
    selectedSeriesId ?? "",
    canManageAssignment,
  );
  const assignResponsible = useAssignSeriesResponsible(selectedSeriesId ?? "");
  const canCreateWithoutGrant = hasCapability(
    globalCapabilities.data?.capabilities,
    "series.create",
  );
  const requiresGrant = requiresSeriesCreationGrant(
    globalCapabilities.data?.capabilities,
  );
  const isGestor = globalCapabilities.data?.role === "gestor";
  const seriesChannels = useSelectableSeriesChannels(creating && isGestor);
  const availableGrants = useAvailableSeriesCreationGrants(requiresGrant);
  const canCreate = canCreateWithoutGrant || requiresGrant;
  const createBlockedByGrant =
    requiresGrant &&
    (!availableGrants.isSuccess || availableGrants.data.length === 0);

  const items = useMemo(() => {
    const filtered = filterSeries(listQuery.data ?? [], query).filter(
      (series) => !responsible || series.responsibleUser?.email === responsible,
    );
    return filtered.map(toSeriesListItem);
  }, [listQuery.data, query, responsible]);
  const responsibleOptions = useMemo(
    () =>
      [
        ...new Set(
          (listQuery.data ?? []).flatMap((item) =>
            item.responsibleUser?.email ? [item.responsibleUser.email] : [],
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
            <div className="grid justify-items-end gap-1.5">
              <Button
                disabled={createBlockedByGrant}
                type="button"
                onClick={() => setCreating((value) => !value)}
              >
                <Plus aria-hidden="true" className="size-4" />
                {creating ? "Cerrar" : "Nueva serie"}
              </Button>
              {createBlockedByGrant ? (
                <p className="m-0 text-xs text-muted">
                  Necesitas una autorización disponible para crear una Serie.{" "}
                  <Link
                    className="text-primary underline"
                    href="/autorizaciones"
                  >
                    Ver autorizaciones
                  </Link>
                </p>
              ) : null}
            </div>
          ) : undefined
        }
      />
      <AppDialog
        busy={create.isPending}
        description="Completa los datos de tu nueva serie."
        open={creating}
        title="Nueva serie"
        onOpenChange={setCreating}
      >
        <SeriesForm
          availableGrants={availableGrants.data ?? []}
          onSubmit={handleCreate}
          onCancel={() => setCreating(false)}
          requiresGrant={requiresGrant}
          requiresDiscordChannel={isGestor}
          selectableChannels={seriesChannels.data?.items ?? []}
          channelsLoading={seriesChannels.isPending}
          channelsError={seriesChannels.isError}
          onRetryChannels={() => void seriesChannels.refetch()}
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
        <section className="grid min-h-0 gap-card xl:grid-cols-[minmax(0,1fr)_minmax(380px,420px)] xl:items-stretch">
          <Card className="flex flex-wrap items-center gap-2 p-3 lg:flex-nowrap xl:col-span-2">
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
            minTableHeightClassName="lg:min-h-[640px]"
            onSelect={selectSeries}
          />
          <SeriesContextPanel open={Boolean(selectedSeriesId)}>
            <SeriesDetailPanel
              series={selectedQuery.data ?? null}
              capabilities={selectedCapabilities.data?.capabilities}
              onClose={() => setSelectedSeriesId(null)}
              onUpdate={async (input) => {
                if (!selectedSeriesId) return;
                await update.mutateAsync(input);
              }}
              onDelete={handleDelete}
              candidates={responsibleCandidates.data}
              candidatesLoading={responsibleCandidates.isPending}
              candidatesError={
                responsibleCandidates.error instanceof Error
                  ? responsibleCandidates.error
                  : null
              }
              assignmentPending={assignResponsible.isPending}
              updatePending={update.isPending}
              deletePending={remove.isPending}
              loading={Boolean(selectedSeriesId) && selectedQuery.isPending}
              error={
                selectedQuery.error instanceof Error
                  ? selectedQuery.error
                  : null
              }
              onRetry={() => void selectedQuery.refetch()}
              onAssignResponsible={async (responsibleUserId) =>
                assignResponsible.mutateAsync(responsibleUserId)
              }
            />
          </SeriesContextPanel>
          <div className="order-3 xl:col-start-1 xl:order-none">
            <Pagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={items.length}
              onPrevious={() => setPage((current) => current - 1)}
              onNext={() => setPage((current) => current + 1)}
            />
          </div>
        </section>
      ) : null}
    </>
  );
}
