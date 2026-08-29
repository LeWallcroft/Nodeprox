"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequestBrowser } from "../../../../lib/api/browser";
import { PageHeader } from "../../../../components/layout/page-header";
import { DataTable } from "../../../../components/ui/data-table";
import { SearchInput } from "../../../../components/ui/search-input";
import { LoadingState } from "../../../../components/ui/loading-state";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { Button } from "../../../../components/ui/button";
import { errorMessage } from "../../../../components/domains/feedback";
import { AuditActionBadge } from "../../../../components/domains/audit/audit-action-badge";

type AuditEvent = {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export default function AuditPage() {
  const [query, setQuery] = useState("");
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const events = useQuery({
    queryKey: ["admin", "audit"],
    queryFn: () => apiRequestBrowser<AuditEvent[]>("/admin/audit"),
    retry: false,
  });
  const rows = useMemo(() => {
    const value = query.trim().toLowerCase();
    return (events.data ?? []).filter(
      (event) =>
        (!value ||
          `${event.actorEmail ?? ""} ${event.action} ${event.resourceType} ${event.resourceId ?? ""}`
            .toLowerCase()
            .includes(value)) &&
        (!actor || event.actorEmail === actor) &&
        (!action || event.action === action) &&
        (!resource || event.resourceType === resource),
    );
  }, [action, actor, events.data, query, resource]);
  const options = useMemo(
    () => ({
      actors: [
        ...new Set(
          (events.data ?? []).map((event) => event.actorEmail).filter(Boolean),
        ),
      ],
      actions: [...new Set((events.data ?? []).map((event) => event.action))],
      resources: [
        ...new Set((events.data ?? []).map((event) => event.resourceType)),
      ],
    }),
    [events.data],
  );
  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Consulta las acciones administrativas y operativas registradas en el sistema."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administración", href: "/admin" },
          { label: "Auditoría", current: true },
        ]}
      />
      <div className="mb-section grid gap-3 rounded-panel border border-border bg-surface p-4 lg:grid-cols-[minmax(0,1fr)_160px_180px_160px_auto]">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Buscar actor, acción o recurso"
        />
        <select
          aria-label="Filtrar por actor"
          value={actor}
          onChange={(event) => setActor(event.target.value)}
        >
          <option value="">Actor</option>
          {options.actors.map((value) => (
            <option key={value} value={value ?? ""}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por acción"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        >
          <option value="">Acción</option>
          {options.actions.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrar por recurso"
          value={resource}
          onChange={(event) => setResource(event.target.value)}
        >
          <option value="">Recurso</option>
          {options.resources.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            setQuery("");
            setActor("");
            setAction("");
            setResource("");
          }}
        >
          Limpiar filtros
        </Button>
      </div>
      {events.isPending ? <LoadingState label="Cargando auditoría" /> : null}
      {events.isError ? (
        <ErrorState
          title="No se pudo cargar la auditoría"
          description={errorMessage(events.error)}
          action={
            <Button type="button" onClick={() => void events.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : null}
      {events.isSuccess && !rows.length ? (
        <EmptyState
          title={
            query
              ? "No se encontraron eventos de auditoría"
              : "No hay eventos de auditoría registrados."
          }
          description={
            query
              ? "Prueba con otros términos de búsqueda."
              : "Los eventos futuros aparecerán aquí."
          }
        />
      ) : null}
      {rows.length ? (
        <>
          <div className="hidden md:block">
            <DataTable label="Eventos de auditoría">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Actor</th>
                  <th>Acción</th>
                  <th>Recurso</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <tr key={event.id}>
                    <td>{new Date(event.createdAt).toLocaleString("es-PE")}</td>
                    <td>{event.actorEmail ?? "Sistema"}</td>
                    <td>
                      <AuditActionBadge action={event.action} />
                    </td>
                    <td>
                      {event.resourceType}
                      {event.resourceId ? ` · ${event.resourceId}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
          <div className="space-y-3 md:hidden">
            {rows.map((event) => (
              <article
                key={event.id}
                className="rounded-panel border border-border bg-surface p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-primary">
                      {event.actorEmail ?? "Sistema"}
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      {new Date(event.createdAt).toLocaleString("es-PE")}
                    </p>
                  </div>
                  <AuditActionBadge action={event.action} />
                </div>
                <p className="mt-3 break-words text-sm text-secondary">
                  {event.resourceType}
                  {event.resourceId ? ` · ${event.resourceId}` : ""}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}
