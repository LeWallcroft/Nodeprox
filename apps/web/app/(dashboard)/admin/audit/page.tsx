"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Download, Eye, FileText, RotateCcw } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AuditActionBadge } from "../../../../components/domains/audit/audit-action-badge";
import { errorMessage } from "../../../../components/domains/feedback";
import { PageHeader } from "../../../../components/layout/page-header";
import { Button } from "../../../../components/ui/button";
import {
  DataTable,
  getSelectableTableRowProps,
} from "../../../../components/ui/data-table";
import {
  DetailPanel,
  DetailPanelContent,
  DetailPanelHeader,
} from "../../../../components/ui/detail-panel";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { LoadingState } from "../../../../components/ui/loading-state";
import { Pagination } from "../../../../components/ui/pagination";
import { SearchInput } from "../../../../components/ui/search-input";
import { SearchableCombobox } from "../../../../components/ui/searchable-combobox";
import { StatusBadge } from "../../../../components/ui/status-badge";
import { apiRequestBrowser } from "../../../../lib/api/browser";
import { useDebouncedAuthorizationValue } from "../../../../lib/domains/authorizations/hooks";

type AuditEvent = {
  id: string;
  actor: {
    id: string | null;
    email: string | null;
    displayName: string | null;
    role: "admin" | "gestor" | "uploader" | null;
  };
  action: string;
  resource: {
    type: string;
    id: string | null;
    chapter: { id: string; number: number; title: string | null } | null;
    series: { id: string; title: string; slug: string } | null;
  };
  result: "success" | "rejected" | "failed" | null;
  reasonCode: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  request: {
    method: string | null;
    endpoint: string | null;
    durationMs: number | null;
    browser: string | null;
    operatingSystem: string | null;
  };
  createdAt: string;
};
type AuditPage = {
  items: AuditEvent[];
  nextCursor: string | null;
  total: number;
};

const allOption = { id: "", label: "Todos" };
const pageSize = 10;

export default function AuditPage() {
  const [query, setQuery] = useState("");
  const [actorId, setActorId] = useState("");
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [result, setResult] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debouncedQuery = useDebouncedAuthorizationValue(query);
  const events = useQuery({
    queryKey: [
      "admin",
      "audit",
      debouncedQuery,
      actorId,
      action,
      resource,
      result,
      from,
      to,
      cursor,
    ],
    queryFn: () =>
      apiRequestBrowser<AuditPage>(
        auditUrl(
          {
            query: debouncedQuery,
            actorId,
            action,
            resource,
            result,
            from,
            to,
          },
          cursor,
        ),
      ),
    retry: false,
  });
  const rows = events.data?.items ?? [];
  const selected = rows.find((event) => event.id === selectedId) ?? null;
  const totalPages = Math.max(
    1,
    Math.ceil((events.data?.total ?? 0) / pageSize),
  );
  const page = cursorHistory.length + 1;
  const options = useMemo(
    () => ({
      actors: [
        allOption,
        ...uniqueOptions(
          rows,
          (event) => event.actor.id,
          (event) => event.actor.email,
        ),
      ],
      actions: [allOption, ...uniqueOptions(rows, (event) => event.action)],
      resources: [
        allOption,
        ...uniqueOptions(rows, (event) => event.resource.type),
      ],
      results: [
        allOption,
        { id: "success", label: "Éxito" },
        { id: "rejected", label: "Rechazado" },
        { id: "failed", label: "Error" },
      ],
    }),
    [rows],
  );

  useEffect(() => {
    if (selectedId && !rows.some((event) => event.id === selectedId))
      setSelectedId(null);
  }, [rows, selectedId]);

  function resetPagination() {
    setCursor(null);
    setCursorHistory([]);
    setSelectedId(null);
  }

  function clearFilters() {
    setQuery("");
    setActorId("");
    setAction("");
    setResource("");
    setResult("");
    setFrom("");
    setTo("");
    resetPagination();
  }

  return (
    <div className="grid gap-section">
      <PageHeader
        title="Auditoría"
        description="Consulta y analiza las acciones registradas en el sistema."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administración", href: "/admin" },
          { label: "Auditoría", current: true },
        ]}
        actions={
          <Link
            className="inline-flex min-h-control items-center justify-center gap-2 rounded-control border border-border bg-surface px-3.5 text-sm font-medium text-text shadow-card transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            href={`/api${auditExportUrl({ query: debouncedQuery, actorId, action, resource, result, from, to })}`}
          >
            <Download aria-hidden="true" className="size-4" /> Exportar
          </Link>
        }
      />
      <section className="grid gap-3 rounded-panel border border-[var(--border-subtle)] bg-surface p-3 lg:grid-cols-2 xl:grid-cols-[minmax(15rem,1.3fr)_minmax(10rem,0.8fr)_minmax(10rem,0.8fr)_auto]">
        <SearchInput
          placeholder="Buscar por usuario, acción o recurso…"
          value={query}
          onChange={(value) => {
            setQuery(value);
            resetPagination();
          }}
        />
        <label className="grid gap-1 text-xs font-medium text-secondary">
          Fecha inicio
          <input
            type="date"
            value={from}
            onChange={(event) => {
              setFrom(event.target.value);
              resetPagination();
            }}
          />
        </label>
        <label className="grid gap-1 text-xs font-medium text-secondary">
          Fecha fin
          <input
            type="date"
            value={to}
            onChange={(event) => {
              setTo(event.target.value);
              resetPagination();
            }}
          />
        </label>
        <div className="flex items-end">
          <Button
            type="button"
            variant="secondary"
            onClick={clearFilters}
            icon={<RotateCcw aria-hidden="true" className="size-4" />}
          >
            Limpiar filtros
          </Button>
        </div>
        <SearchableCombobox
          id="audit-action"
          label="Evento"
          labelHidden
          value={action}
          options={options.actions}
          onChange={(value) => {
            setAction(value);
            resetPagination();
          }}
          placeholder="Todos los eventos"
        />
        <SearchableCombobox
          id="audit-actor"
          label="Usuario"
          labelHidden
          value={actorId}
          options={options.actors}
          onChange={(value) => {
            setActorId(value);
            resetPagination();
          }}
          placeholder="Todos los usuarios"
        />
        <SearchableCombobox
          id="audit-resource"
          label="Recurso"
          labelHidden
          value={resource}
          options={options.resources}
          onChange={(value) => {
            setResource(value);
            resetPagination();
          }}
          placeholder="Todos los recursos"
        />
        <SearchableCombobox
          id="audit-result"
          label="Resultado"
          labelHidden
          value={result}
          options={options.results}
          onChange={(value) => {
            setResult(value);
            resetPagination();
          }}
          placeholder="Todos los resultados"
        />
      </section>
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
          title="No hay eventos que coincidan con los filtros."
          description="Prueba con otros criterios de búsqueda."
        />
      ) : null}
      {rows.length ? (
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,430px)]">
          <div className="min-w-0">
            <DataTable
              fillRemainingSpace
              label="Eventos de auditoría"
              minHeightClassName="lg:min-h-[640px]"
              tableClassName="min-w-[860px] table-fixed"
            >
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="w-[8.5rem] p-3">Fecha y hora</th>
                  <th className="w-[9.5rem] p-3">Usuario</th>
                  <th className="w-[7.5rem] p-3">Acción</th>
                  <th className="w-24 p-3">Recurso</th>
                  <th className="p-3">Detalle</th>
                  <th className="w-28 p-3">IP</th>
                  <th className="w-24 p-3">Resultado</th>
                  <th className="w-14 p-3 text-center">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((event) => (
                  <AuditRow
                    key={event.id}
                    event={event}
                    selected={event.id === selectedId}
                    onSelect={() => setSelectedId(event.id)}
                  />
                ))}
              </tbody>
            </DataTable>
            <div className="mt-3">
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={events.data?.total ?? 0}
                onPrevious={() =>
                  setCursorHistory((history) => {
                    const previous = history.at(-1);
                    setCursor(previous || null);
                    return history.slice(0, -1);
                  })
                }
                onNext={() =>
                  setCursorHistory((history) => {
                    if (!events.data?.nextCursor) return history;
                    setCursor(events.data.nextCursor);
                    return [...history, cursor ?? ""];
                  })
                }
              />
              <p className="mb-0 mt-2 text-xs text-muted">
                Consulta paginada y filtrada directamente en el servidor.
              </p>
            </div>
          </div>
          <div className="min-h-[420px] xl:h-[640px]">
            <AuditDetailPanel
              event={selected}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AuditRow({
  event,
  selected,
  onSelect,
}: {
  event: AuditEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      {...getSelectableTableRowProps(onSelect)}
      data-selected={selected || undefined}
      className={`h-14 cursor-pointer ${selected ? "bg-primary-soft" : "hover:bg-surface-elevated"}`}
    >
      <td className="truncate p-3 text-xs text-secondary">
        {formatDate(event.createdAt)}
      </td>
      <td className="truncate p-3 text-sm text-text">
        {event.actor.email ?? "Sistema"}
      </td>
      <td className="p-3">
        <AuditActionBadge action={event.action} />
      </td>
      <td className="truncate p-3 text-sm text-secondary">
        {event.resource.type}
      </td>
      <td
        className="truncate p-3 text-sm text-secondary"
        title={eventDetail(event)}
      >
        {eventDetail(event)}
      </td>
      <td className="truncate p-3 font-mono text-xs text-secondary">
        {event.ipAddress ?? "—"}
      </td>
      <td className="p-3">
        <AuditResultBadge action={event.action} result={event.result} />
      </td>
      <td className="p-3 text-center">
        <button
          aria-label={`Ver detalle de ${event.action}`}
          className="grid size-8 place-items-center rounded-control border border-[var(--border-subtle)] text-secondary hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          type="button"
          onClick={(click) => {
            click.stopPropagation();
            onSelect();
          }}
        >
          <Eye aria-hidden="true" className="size-4" />
        </button>
      </td>
    </tr>
  );
}

function AuditDetailPanel({
  event,
  onClose,
}: {
  event: AuditEvent | null;
  onClose: () => void;
}) {
  return (
    <DetailPanel>
      <DetailPanelHeader>
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-base font-semibold text-text">
            Detalle del evento
          </h2>
          <button
            aria-label="Cerrar detalle"
            className="grid size-8 place-items-center rounded-control border border-[var(--border-subtle)] text-secondary hover:bg-surface-hover"
            type="button"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </DetailPanelHeader>
      <DetailPanelContent scrollable>
        {event ? (
          <div className="grid gap-5">
            <div className="flex items-center justify-between gap-3">
              <AuditActionBadge action={event.action} />
              <time
                className="text-right text-xs text-muted"
                dateTime={event.createdAt}
              >
                {formatDate(event.createdAt)}
              </time>
            </div>
            <p className="m-0 text-sm text-secondary">{eventDetail(event)}</p>
            <AuditSection label="Usuario">
              <div className="flex items-center gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  {actorInitials(event.actor.displayName ?? event.actor.email)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 truncate text-sm font-semibold text-text">
                      {actorName(event)}
                    </p>
                    {event.actor.role ? (
                      <RoleBadge role={event.actor.role} />
                    ) : null}
                  </div>
                  {event.actor.email && event.actor.displayName ? (
                    <p className="m-0 truncate text-sm text-secondary">
                      {event.actor.email}
                    </p>
                  ) : null}
                  {event.actor.id ? (
                    <p className="m-0 truncate font-mono text-xs text-muted">
                      ID: {event.actor.id}
                    </p>
                  ) : null}
                </div>
              </div>
            </AuditSection>
            <AuditSection label="Recurso afectado">
              <ResourceSummary resource={event.resource} />
            </AuditSection>
            <div className="grid gap-2 border-t border-[var(--border-subtle)] pt-4">
              <p className="m-0 text-sm font-semibold text-text">Resultado</p>
              <div className="flex items-center gap-2 text-sm text-secondary">
                <CheckCircle2
                  aria-hidden="true"
                  className={`size-5 ${resultIconClass(event.result)}`}
                />
                <span>{resultMessage(event.result)}</span>
              </div>
              {event.reasonCode ? (
                <p className="m-0 text-sm text-secondary">
                  Motivo: {event.reasonCode}
                </p>
              ) : null}
            </div>
            <div className="grid gap-2 border-t border-[var(--border-subtle)] pt-4">
              <p className="m-0 text-sm font-semibold text-text">
                Información disponible
              </p>
              <div className="grid gap-2 text-sm text-secondary">
                <TechnicalMeta label="Dirección IP" value={event.ipAddress} />
                <TechnicalMeta
                  label="Navegador"
                  value={event.request.browser}
                />
                <TechnicalMeta
                  label="Sistema operativo"
                  value={event.request.operatingSystem}
                />
                <TechnicalMeta label="Método" value={event.request.method} />
                <TechnicalMeta
                  label="Endpoint"
                  value={event.request.endpoint}
                />
                <TechnicalMeta
                  label="Duración"
                  value={
                    event.request.durationMs === null
                      ? null
                      : `${event.request.durationMs} ms`
                  }
                />
                <TechnicalMeta
                  label="ID de solicitud"
                  value={event.requestId}
                />
              </div>
              {Object.keys(event.metadata).length ? (
                <div className="grid gap-2 border-t border-[var(--border-subtle)] pt-4">
                  <p className="m-0 text-sm font-semibold text-text">
                    Cambios realizados
                  </p>
                  <pre className="max-h-44 overflow-auto rounded-control border border-[var(--border-subtle)] bg-surface-elevated p-3 text-xs text-secondary">
                    {JSON.stringify(event.metadata, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="m-0 text-sm text-muted">
                  No hay cambios adicionales registrados.
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="grid h-full min-h-64 place-items-center text-center">
            <div>
              <FileText
                aria-hidden="true"
                className="mx-auto size-8 text-primary"
              />
              <p className="mb-0 mt-3 font-medium text-text">
                Selecciona un evento
              </p>
              <p className="m-0 text-sm text-secondary">
                Sus datos aparecerán aquí sin cambiar la geometría del panel.
              </p>
            </div>
          </div>
        )}
      </DetailPanelContent>
    </DetailPanel>
  );
}

function AuditSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2 border-t border-[var(--border-subtle)] pt-4">
      <p className="m-0 text-sm font-semibold text-text">{label}</p>
      {children}
    </section>
  );
}

function TechnicalMeta({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  if (!value) return null;
  return (
    <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-3">
      <span className="text-muted">{label}</span>
      <span className="break-words text-text-secondary">{value}</span>
    </div>
  );
}

function RoleBadge({
  role,
}: {
  role: NonNullable<AuditEvent["actor"]["role"]>;
}) {
  return (
    <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium capitalize text-primary">
      {role}
    </span>
  );
}

function ResourceSummary({ resource }: { resource: AuditEvent["resource"] }) {
  const chapter = resource.chapter;
  const series = resource.series;
  return (
    <div className="flex gap-3">
      <div className="grid size-11 shrink-0 place-items-center rounded-control border border-[var(--border-subtle)] bg-surface-elevated text-primary">
        <FileText aria-hidden="true" className="size-5" />
      </div>
      <div className="min-w-0 text-sm text-secondary">
        <p className="m-0 font-semibold text-text">
          {chapter ? "Capítulo" : resource.type}
        </p>
        {resource.id ? <p className="m-0 truncate">ID: {resource.id}</p> : null}
        {series ? <p className="m-0">Serie: {series.title}</p> : null}
        {chapter ? <p className="m-0">Número: {chapter.number}</p> : null}
        {chapter?.title ? <p className="m-0">Título: {chapter.title}</p> : null}
        {series && !chapter ? <p className="m-0">Slug: {series.slug}</p> : null}
      </div>
    </div>
  );
}

function AuditResultBadge({
  action,
  result,
}: {
  action?: string;
  result: AuditEvent["result"];
}) {
  const normalizedAction = action?.toLowerCase();
  if (normalizedAction === "chapter.upload.initiated")
    return <StatusBadge label="Iniciada" tone="info" />;
  if (normalizedAction === "chapter.upload.aborted")
    return <StatusBadge label="Cancelada" tone="warning" />;
  if (normalizedAction === "chapter.upload.expired")
    return <StatusBadge label="Expirada" tone="warning" />;
  const presentation =
    result === "success"
      ? { label: "Éxito", tone: "success" as const }
      : result === "rejected"
        ? { label: "Rechazado", tone: "warning" as const }
        : result === "failed"
          ? { label: "Error", tone: "danger" as const }
          : { label: "Sin resultado", tone: "neutral" as const };
  return <StatusBadge label={presentation.label} tone={presentation.tone} />;
}

function uniqueOptions(
  events: readonly AuditEvent[],
  select: (event: AuditEvent) => string | null,
  label: (event: AuditEvent) => string | null = select,
) {
  return [
    ...new Set(
      events
        .map((event) => {
          const id = select(event);
          return id ? JSON.stringify([id, label(event) ?? id]) : null;
        })
        .filter((value): value is string => Boolean(value)),
    ),
  ].map((value) => {
    const [id, text] = JSON.parse(value) as [string, string];
    return { id, label: text };
  });
}
function eventDetail(event: AuditEvent): string {
  const action =
    {
      "chapter.created": "Creó",
      "chapter.upload.initiated": "Inició carga para",
      "chapter.upload.completed": "Completó carga para",
      "chapter.upload.aborted": "Canceló carga para",
      "chapter.upload.failed": "Falló carga para",
      "chapter.images.replaced": "Reemplazó imágenes de",
      "series.created": "Creó",
    }[event.action] ?? event.action;
  if (event.resource.chapter)
    return `${action} capítulo ${event.resource.chapter.number}${event.resource.series ? ` en serie '${event.resource.series.title}'` : ""}`;
  if (event.resource.series)
    return `${action} serie '${event.resource.series.title}'`;
  return event.reasonCode
    ? `${event.action} · ${event.reasonCode}`
    : event.resource.id
      ? `${event.action} · ${event.resource.id}`
      : event.action;
}

function actorName(event: AuditEvent): string {
  return event.actor.displayName ?? event.actor.email ?? "Sistema";
}

function actorInitials(value: string | null): string {
  return (value ?? "Sistema")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function resultMessage(result: AuditEvent["result"]): string {
  if (result === "success") return "Operación completada exitosamente";
  if (result === "rejected")
    return "Operación rechazada por una regla del sistema";
  if (result === "failed") return "La operación no pudo completarse";
  return "Resultado no disponible";
}

function resultIconClass(result: AuditEvent["result"]): string {
  if (result === "success") return "text-success";
  if (result === "rejected") return "text-warning";
  if (result === "failed") return "text-danger";
  return "text-muted";
}

function auditUrl(
  filters: {
    query: string;
    actorId: string;
    action: string;
    resource: string;
    result: string;
    from: string;
    to: string;
  },
  cursor: string | null,
) {
  const params = new URLSearchParams({ limit: String(pageSize) });
  if (filters.query.trim()) params.set("search", filters.query.trim());
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.action) params.set("action", filters.action);
  if (filters.resource) params.set("resourceType", filters.resource);
  if (filters.result) params.set("result", filters.result);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (cursor) params.set("cursor", cursor);
  return `/admin/audit?${params.toString()}`;
}

function auditExportUrl(filters: Parameters<typeof auditUrl>[0]) {
  return auditUrl(filters, null).replace(
    "/admin/audit?",
    "/admin/audit/export?",
  );
}
function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}
