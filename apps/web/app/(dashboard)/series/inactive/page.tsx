"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { InactiveSeriesDetailPanel } from "../../../../components/domains/series/inactive-series-detail-panel";
import { SeriesCoverPreview } from "../../../../components/domains/series/series-cover-preview";
import { PageHeader } from "../../../../components/layout/page-header";
import {
  DataTable,
  DataTableEmptyRow,
  getSelectableTableRowProps,
} from "../../../../components/ui/data-table";
import { ErrorState } from "../../../../components/ui/error-state";
import { LoadingState } from "../../../../components/ui/loading-state";
import { SearchableCombobox } from "../../../../components/ui/searchable-combobox";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { useCapabilities } from "../../../../lib/domains/auth/hooks";
import { useSeriesList } from "../../../../lib/domains/series/hooks";
import type { SeriesListProjection } from "../../../../lib/domains/series/types";
import { userPrimaryLabel } from "../../../../lib/domains/users/presentation";

const reasonLabels = {
  dropped: "Dropeada",
  hiatus: "Hiatus",
  completed: "Terminada",
  other: "Otros",
} as const;

export default function InactiveSeriesPage() {
  const list = useSeriesList("inactive");
  const capabilities = useCapabilities();
  const isAdmin = capabilities.data?.role === "admin";
  const activeSeries = useSeriesList("active", isAdmin);
  const [view, setView] = useState<"inactive" | "approved">("inactive");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [requestState, setRequestState] = useState("all");
  const approvedRows = useMemo(() => {
    const allSeries = [...(list.data ?? []), ...(activeSeries.data ?? [])];
    return allSeries
      .filter((series) => series.hasApprovedReactivationRequest)
      .sort(
        (a, b) =>
          new Date(b.lastApprovedAt ?? 0).getTime() -
            new Date(a.lastApprovedAt ?? 0).getTime() ||
          b.id.localeCompare(a.id),
      );
  }, [activeSeries.data, list.data]);
  const sourceRows = view === "inactive" ? (list.data ?? []) : approvedRows;
  const rows = useMemo(
    () =>
      sourceRows.filter((series) => {
        if (
          !`${series.title} ${series.slug}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())
        )
          return false;
        if (view === "inactive" && reason && series.inactiveReason !== reason)
          return false;
        if (responsibleId && series.responsibleUser?.id !== responsibleId)
          return false;
        if (
          view === "inactive" &&
          requestState === "pending" &&
          !series.hasPendingReactivationRequest
        )
          return false;
        if (
          view === "inactive" &&
          requestState === "none" &&
          series.hasPendingReactivationRequest
        )
          return false;
        return true;
      }),
    [sourceRows, search, reason, responsibleId, requestState, view],
  );
  const selected: SeriesListProjection | null =
    sourceRows.find((series) => series.id === selectedId) ?? null;
  const responsibles = [
    ...new Map(
      sourceRows.flatMap((series) =>
        series.responsibleUser
          ? [[series.responsibleUser.id, series.responsibleUser] as const]
          : [],
      ),
    ).values(),
  ];
  return (
    <div className="grid gap-4">
      <PageHeader
        title="Tablón olvidado"
        description="Series deshabilitadas y su historial. El contenido permanece almacenado."
        back={{ label: "Volver a Series", href: "/series" }}
      />
      {isAdmin ? (
        <div
          aria-label="Vistas del tablón"
          className="inline-flex w-fit items-center gap-1 rounded-control bg-surface p-1"
          role="tablist"
        >
          <button
            type="button"
            role="tab"
            aria-selected={view === "inactive"}
            onClick={() => {
              setView("inactive");
              setSelectedId(null);
            }}
            className={`min-h-9 rounded-control px-3.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${view === "inactive" ? "bg-primary-soft text-text shadow-card" : "text-secondary hover:bg-surface-hover hover:text-text"}`}
          >
            Deshabilitadas
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "approved"}
            onClick={() => {
              setView("approved");
              setSelectedId(null);
            }}
            className={`min-h-9 rounded-control px-3.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${view === "approved" ? "bg-primary-soft text-text shadow-card" : "text-secondary hover:bg-surface-hover hover:text-text"}`}
          >
            Historial aprobado
          </button>
        </div>
      ) : null}
      <section className="rounded-panel border border-border bg-surface p-4 shadow-card">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text">
          <SlidersHorizontal
            aria-hidden="true"
            className="size-4 text-primary"
          />
          Filtros
        </h2>
        <div
          className={`grid gap-3 ${view === "inactive" ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-2"}`}
        >
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-secondary">
            <span className="flex items-center gap-1.5">
              <Search aria-hidden="true" className="size-3.5 text-muted" />
              Buscar serie
            </span>
            <input
              className="h-10 min-w-0 rounded-control border border-border bg-surface-elevated px-3 text-sm text-text shadow-card transition-colors placeholder:text-muted hover:border-primary/40 focus-visible:border-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Título o slug"
            />
          </label>
          {view === "inactive" ? (
            <BoardFilterCombobox
              id="inactive-series-reason"
              label="Motivo"
              value={reason}
              onChange={setReason}
              options={[
                { id: "", label: "Todos los motivos" },
                ...Object.entries(reasonLabels).map(([id, label]) => ({
                  id,
                  label,
                })),
              ]}
            />
          ) : null}
          <BoardFilterCombobox
            id="inactive-series-responsible"
            label="Responsable"
            value={responsibleId}
            onChange={setResponsibleId}
            options={[
              { id: "", label: "Todos los responsables" },
              ...responsibles.map((user) => ({
                id: user.id,
                label: userPrimaryLabel(user),
              })),
            ]}
          />
          {view === "inactive" ? (
            <BoardFilterCombobox
              id="inactive-series-request-state"
              label="Solicitud"
              value={requestState}
              onChange={setRequestState}
              options={[
                { id: "all", label: "Todas las solicitudes" },
                { id: "pending", label: "Pendientes" },
                { id: "none", label: "Sin solicitud pendiente" },
              ]}
            />
          ) : null}
        </div>
      </section>
      {list.isLoading || (view === "approved" && activeSeries.isLoading) ? (
        <LoadingState
          label={
            view === "approved"
              ? "Cargando historial aprobado"
              : "Cargando series deshabilitadas"
          }
        />
      ) : null}
      {list.isError || (view === "approved" && activeSeries.isError) ? (
        <ErrorState
          title="No se pudo cargar el tablón"
          description={
            (list.error ?? activeSeries.error)?.message ?? "Inténtalo de nuevo."
          }
        />
      ) : null}
      {!list.isLoading &&
      !list.isError &&
      !(view === "approved" && activeSeries.isLoading) &&
      !(view === "approved" && activeSeries.isError) ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <DataTable
            label={
              view === "approved"
                ? "Historial de series aprobadas"
                : "Series deshabilitadas"
            }
          >
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Serie</th>
                {view === "inactive" ? (
                  <th className="p-3">Motivo</th>
                ) : (
                  <th className="p-3">Estado actual</th>
                )}
                <th className="p-3">Responsable</th>
                {view === "inactive" ? (
                  <th className="p-3">Solicitud</th>
                ) : (
                  <th className="p-3">Última aprobación</th>
                )}
                <th className="p-3">Actualizada</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((series) => (
                  <tr
                    key={series.id}
                    {...getSelectableTableRowProps(() =>
                      setSelectedId(series.id),
                    )}
                    className={`cursor-pointer hover:bg-surface-elevated ${selectedId === series.id ? "bg-primary-soft" : ""}`}
                  >
                    <td className="flex min-w-48 items-center gap-2 p-3">
                      <SeriesCoverPreview
                        compact
                        coverUrl={series.coverUrl}
                        title={series.title}
                      />
                      <span className="truncate font-medium">
                        {series.title}
                      </span>
                    </td>
                    {view === "inactive" ? (
                      <td className="p-3">
                        {series.inactiveReason
                          ? reasonLabels[series.inactiveReason]
                          : "—"}
                      </td>
                    ) : (
                      <td className="p-3">
                        <StatusBadge
                          label={
                            series.operationalState === "active"
                              ? "Activa"
                              : "Deshabilitada"
                          }
                          tone={
                            series.operationalState === "active"
                              ? "success"
                              : "warning"
                          }
                        />
                      </td>
                    )}
                    <td className="p-3">
                      {series.responsibleUser
                        ? userPrimaryLabel(series.responsibleUser)
                        : "Sin responsable"}
                    </td>
                    {view === "inactive" ? (
                      <td className="p-3">
                        {series.hasPendingReactivationRequest ? (
                          <StatusBadge label="Pendiente" tone="info" />
                        ) : (
                          "—"
                        )}
                      </td>
                    ) : (
                      <td className="whitespace-nowrap p-3 text-muted">
                        {series.lastApprovedAt
                          ? new Date(series.lastApprovedAt).toLocaleDateString(
                              "es-PE",
                            )
                          : "—"}
                      </td>
                    )}
                    <td className="whitespace-nowrap p-3 text-muted">
                      {new Date(series.stateChangedAt).toLocaleDateString(
                        "es-PE",
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <DataTableEmptyRow
                  colSpan={5}
                  title={
                    view === "approved"
                      ? "No hay series aprobadas"
                      : "No hay series deshabilitadas"
                  }
                  description={
                    view === "approved"
                      ? "Las series aparecerán aquí cuando Administración apruebe una solicitud de habilitación."
                      : "Ajusta los filtros o vuelve a Series."
                  }
                />
              )}
            </tbody>
          </DataTable>
          {selected ? (
            <InactiveSeriesDetailPanel
              key={selected.id}
              series={selected}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <aside className="rounded-panel border border-border bg-surface p-5 text-muted">
              {view === "approved"
                ? "Selecciona una serie para consultar sus aprobaciones y transiciones."
                : "Selecciona una serie para ver el historial y las acciones disponibles."}
            </aside>
          )}
        </div>
      ) : null}
    </div>
  );
}

function BoardFilterCombobox({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
}) {
  return (
    <SearchableCombobox
      id={id}
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      controlClassName="w-full"
      placeholder="Buscar…"
      emptyMessage="No hay opciones disponibles."
    />
  );
}
