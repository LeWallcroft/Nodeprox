"use client";

import { useMemo, useState } from "react";
import { InactiveSeriesDetailPanel } from "../../../../components/domains/series/inactive-series-detail-panel";
import { PageHeader } from "../../../../components/layout/page-header";
import { SeriesCoverPreview } from "../../../../components/domains/series/series-cover-preview";
import {
  DataTable,
  DataTableEmptyRow,
  getSelectableTableRowProps,
} from "../../../../components/ui/data-table";
import { ErrorState } from "../../../../components/ui/error-state";
import { LoadingState } from "../../../../components/ui/loading-state";
import { StatusBadge } from "../../../../components/ui/status-badge";
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [requestState, setRequestState] = useState("all");
  const rows = useMemo(
    () =>
      (list.data ?? []).filter((series) => {
        if (
          !`${series.title} ${series.slug}`
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())
        )
          return false;
        if (reason && series.inactiveReason !== reason) return false;
        if (responsibleId && series.responsibleUser?.id !== responsibleId)
          return false;
        if (requestState === "pending" && !series.hasPendingReactivationRequest)
          return false;
        if (requestState === "none" && series.hasPendingReactivationRequest)
          return false;
        return true;
      }),
    [list.data, search, reason, responsibleId, requestState],
  );
  const selected: SeriesListProjection | null =
    (list.data ?? []).find((series) => series.id === selectedId) ?? null;
  const responsibles = [
    ...new Map(
      (list.data ?? []).flatMap((series) =>
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
      <div className="grid gap-3 rounded-panel border border-border bg-surface p-4 shadow-card sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-sm">
          Buscar
          <input
            className="min-h-control rounded-control border border-border bg-surface-elevated px-3"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Título o slug"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Motivo
          <select
            className="min-h-control rounded-control border border-border bg-surface-elevated px-3"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          >
            <option value="">Todos</option>
            {Object.entries(reasonLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Responsable
          <select
            className="min-h-control rounded-control border border-border bg-surface-elevated px-3"
            value={responsibleId}
            onChange={(event) => setResponsibleId(event.target.value)}
          >
            <option value="">Todos</option>
            {responsibles.map((user) => (
              <option key={user.id} value={user.id}>
                {userPrimaryLabel(user)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          Solicitud
          <select
            className="min-h-control rounded-control border border-border bg-surface-elevated px-3"
            value={requestState}
            onChange={(event) => setRequestState(event.target.value)}
          >
            <option value="all">Todas</option>
            <option value="pending">Pendiente</option>
            <option value="none">Sin solicitud pendiente</option>
          </select>
        </label>
      </div>
      {list.isLoading ? (
        <LoadingState label="Cargando series deshabilitadas" />
      ) : null}
      {list.isError ? (
        <ErrorState
          title="No se pudo cargar el tablón"
          description={list.error.message}
        />
      ) : null}
      {!list.isLoading && !list.isError ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <DataTable label="Series deshabilitadas">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                <th className="p-3">Serie</th>
                <th className="p-3">Motivo</th>
                <th className="p-3">Responsable</th>
                <th className="p-3">Solicitud</th>
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
                    <td className="p-3">
                      {series.inactiveReason
                        ? reasonLabels[series.inactiveReason]
                        : "—"}
                    </td>
                    <td className="p-3">
                      {series.responsibleUser
                        ? userPrimaryLabel(series.responsibleUser)
                        : "Sin responsable"}
                    </td>
                    <td className="p-3">
                      {series.hasPendingReactivationRequest ? (
                        <StatusBadge label="Pendiente" tone="info" />
                      ) : (
                        "—"
                      )}
                    </td>
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
                  title="No hay series deshabilitadas"
                  description="Ajusta los filtros o vuelve a Series."
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
              Selecciona una serie para ver el historial y las acciones
              disponibles.
            </aside>
          )}
        </div>
      ) : null}
    </div>
  );
}
