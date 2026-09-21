"use client";

import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  ListChecks,
  PauseCircle,
  Pencil,
  UserRoundCheck,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { errorMessage } from "../../../../components/domains/feedback";
import { PageHeader } from "../../../../components/layout/page-header";
import { AppDialog } from "../../../../components/ui/app-dialog";
import { Button } from "../../../../components/ui/button";
import { ConfirmationDialog } from "../../../../components/ui/confirmation-dialog";
import { ContentImage } from "../../../../components/ui/content-image";
import { useCopyToClipboard } from "../../../../components/ui/copy-button";
import {
  DataTable,
  getSelectableTableRowProps,
} from "../../../../components/ui/data-table";
import {
  DetailPanel,
  DetailPanelActions,
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
import { useDebouncedAuthorizationValue } from "../../../../lib/domains/authorizations/hooks";
import { useSeriesList } from "../../../../lib/domains/series/hooks";
import type { SeriesListProjection } from "../../../../lib/domains/series/types";
import {
  useManagedUsersPage,
  useReplaceManagedUserSeries,
  useReviewManagedUser,
} from "../../../../lib/domains/users/hooks";
import type {
  ManagedUserProjection,
  ManagedUserRole,
  ManagedUserStatus,
} from "../../../../lib/domains/users/types";

const pageSize = 10;
const roles = [
  { id: "", label: "Rol: Todos" },
  { id: "admin", label: "Administrador" },
  { id: "gestor", label: "Gestor" },
  { id: "uploader", label: "Uploader" },
] as const;
const statuses = [
  { id: "", label: "Estado: Todos" },
  { id: "active", label: "Activo" },
  { id: "pending", label: "Pendiente" },
  { id: "suspended", label: "Suspendido" },
  { id: "rejected", label: "Rechazado" },
] as const;

export default function AdminUsersPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<ManagedUserRole | "">("");
  const [statusFilter, setStatusFilter] = useState<ManagedUserStatus | "">("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagedUserProjection | null>(null);
  const [nextRole, setNextRole] = useState<ManagedUserRole>("uploader");
  const [confirmation, setConfirmation] = useState<{
    user: ManagedUserProjection;
    status: Extract<ManagedUserStatus, "active" | "suspended">;
  } | null>(null);
  const [seriesDialog, setSeriesDialog] = useState<{
    user: ManagedUserProjection;
    mode: "view" | "assign";
  } | null>(null);
  const query = useDebouncedAuthorizationValue(search);
  const users = useManagedUsersPage({
    ...(query ? { search: query } : {}),
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    cursor,
    limit: pageSize,
  });
  const review = useReviewManagedUser();
  const replacement = useReplaceManagedUserSeries();
  const series = useSeriesList();
  const rows = users.data?.items ?? [];
  const selected = rows.find((user) => user.id === selectedId) ?? null;
  const page = history.length + 1;
  const totalPages = Math.max(
    1,
    Math.ceil((users.data?.total ?? 0) / pageSize),
  );

  useEffect(() => {
    if (selectedId && !rows.some((user) => user.id === selectedId))
      setSelectedId(null);
  }, [rows, selectedId]);
  const reset = () => {
    setCursor(null);
    setHistory([]);
    setSelectedId(null);
  };
  async function saveRole() {
    if (!editing) return;
    await review.mutateAsync({
      userId: editing.id,
      input: {
        status: editing.status === "suspended" ? "active" : "active",
        role: nextRole,
      },
    });
    setEditing(null);
  }
  async function changeStatus() {
    if (!confirmation) return;
    await review.mutateAsync({
      userId: confirmation.user.id,
      input: { status: confirmation.status },
    });
    setConfirmation(null);
  }
  async function replaceAssignments(seriesIds: readonly string[]) {
    if (!seriesDialog) return;
    await replacement.mutateAsync({
      userId: seriesDialog.user.id,
      seriesIds,
    });
    setSeriesDialog(null);
  }

  return (
    <div className="grid gap-section">
      <PageHeader
        title="Usuarios"
        description="Gestiona los usuarios de la plataforma."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administración", href: "/admin" },
          { label: "Usuarios", current: true },
        ]}
      />
      <section className="grid gap-3 rounded-panel border border-[var(--border-subtle)] bg-surface p-3 md:grid-cols-[minmax(14rem,1fr)_12rem_12rem]">
        <SearchInput
          placeholder="Buscar usuarios…"
          value={search}
          onChange={(value) => {
            setSearch(value);
            reset();
          }}
        />
        <SearchableCombobox
          id="users-role"
          label="Rol"
          labelHidden
          options={roles}
          value={roleFilter}
          onChange={(value) => {
            setRoleFilter(value as ManagedUserRole | "");
            reset();
          }}
        />
        <SearchableCombobox
          id="users-status"
          label="Estado"
          labelHidden
          options={statuses}
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value as ManagedUserStatus | "");
            reset();
          }}
        />
      </section>
      {users.isPending ? <LoadingState label="Cargando usuarios" /> : null}
      {users.isError ? (
        <ErrorState
          title="No se pudieron cargar los usuarios"
          description={errorMessage(users.error)}
          action={
            <Button type="button" onClick={() => void users.refetch()}>
              Reintentar
            </Button>
          }
        />
      ) : null}
      {users.isSuccess && !rows.length ? (
        <EmptyState
          title="No hay usuarios"
          description="No hay cuentas que coincidan con los filtros actuales."
        />
      ) : null}
      {rows.length ? (
        <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(360px,430px)]">
          <div className="min-w-0">
            <DataTable
              fillRemainingSpace
              label="Usuarios"
              minHeightClassName="lg:min-h-[640px]"
              tableClassName="min-w-[860px] table-fixed"
            >
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="w-[14rem] p-3">Usuario</th>
                  <th className="w-36 p-3">Usuario Discord</th>
                  <th className="w-28 p-3">Rol</th>
                  <th className="w-28 p-3">Series asignadas</th>
                  <th className="w-28 p-3">Estado</th>
                  <th className="w-36 p-3">Último acceso</th>
                  <th className="w-14 p-3 text-center">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    selected={user.id === selectedId}
                    onSelect={() => setSelectedId(user.id)}
                  />
                ))}
              </tbody>
            </DataTable>
            <div className="mt-3">
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={users.data?.total ?? 0}
                isLoading={users.isFetching}
                onPrevious={() =>
                  setHistory((items) => {
                    setCursor(items.at(-1) ?? null);
                    return items.slice(0, -1);
                  })
                }
                onNext={() => {
                  if (!users.data?.nextCursor) return;
                  setHistory((items) => [...items, cursor ?? ""]);
                  setCursor(users.data.nextCursor);
                }}
              />
            </div>
          </div>
          <div className="min-h-[420px] xl:h-[640px]">
            <UserDetailPanel
              user={selected}
              busy={review.isPending}
              onClose={() => setSelectedId(null)}
              onEdit={(user) => {
                setEditing(user);
                setNextRole(user.role ?? "uploader");
              }}
              onStatus={(user, status) => setConfirmation({ user, status })}
              onViewSeries={(user) => setSeriesDialog({ user, mode: "view" })}
              onAssignSeries={(user) =>
                setSeriesDialog({ user, mode: "assign" })
              }
            />
          </div>
        </div>
      ) : null}
      <AppDialog
        open={Boolean(editing)}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title="Editar usuario"
        {...(editing ? { description: editing.email } : {})}
        busy={review.isPending}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditing(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={review.isPending}
              onClick={() => void saveRole()}
            >
              Guardar
            </Button>
          </div>
        }
      >
        <SearchableCombobox
          id="edit-user-role"
          label="Rol"
          options={roles.slice(1)}
          value={nextRole}
          onChange={(value) => setNextRole(value as ManagedUserRole)}
        />
      </AppDialog>
      <ConfirmationDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={
          confirmation?.status === "suspended"
            ? "Desactivar usuario"
            : confirmation?.user.status === "pending"
              ? "Aprobar usuario"
              : "Reactivar usuario"
        }
        description={
          confirmation?.status === "suspended"
            ? "Se revocarán sus sesiones, responsabilidades de Series y colaboraciones activas de capítulos. El historial se conservará."
            : confirmation?.user.status === "pending"
              ? "La cuenta quedará activa y el usuario podrá iniciar sesión en NodeProx."
              : "El usuario recuperará el acceso, pero sus asignaciones anteriores no se restaurarán automáticamente."
        }
        confirmLabel={
          confirmation?.status === "suspended"
            ? "Desactivar usuario"
            : confirmation?.user.status === "pending"
              ? "Aprobar usuario"
              : "Reactivar usuario"
        }
        pending={review.isPending}
        onConfirm={() => void changeStatus()}
      />
      <UserSeriesDialog
        open={Boolean(seriesDialog)}
        onOpenChange={(open) => {
          if (!open) setSeriesDialog(null);
        }}
        user={seriesDialog?.user ?? null}
        mode={seriesDialog?.mode ?? "view"}
        series={series.data ?? []}
        loading={series.isPending}
        busy={replacement.isPending}
        onSave={(seriesIds) => void replaceAssignments(seriesIds)}
      />
    </div>
  );
}

function UserRow({
  user,
  selected,
  onSelect,
}: {
  user: ManagedUserProjection;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      {...getSelectableTableRowProps(onSelect)}
      className={`h-14 cursor-pointer ${selected ? "bg-primary-soft" : "hover:bg-surface-elevated"}`}
    >
      <td className="truncate p-3 text-sm text-text">{user.email}</td>
      <td className="truncate p-3 text-sm text-secondary">
        {user.discordUsername ?? "—"}
      </td>
      <td className="p-3">
        <RoleBadge role={user.role ?? "uploader"} />
      </td>
      <td className="p-3 text-sm text-secondary">{user.assignedSeriesCount}</td>
      <td className="p-3">
        <UserStatusBadge status={user.status} />
      </td>
      <td className="p-3 text-xs text-secondary">
        {formatDate(user.lastAccessAt)}
      </td>
      <td className="p-3 text-center">
        <button
          aria-label={`Ver detalle de ${user.email}`}
          type="button"
          className="grid size-8 place-items-center rounded-control border border-[var(--border-subtle)] text-secondary hover:bg-surface-hover"
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <Eye aria-hidden="true" className="size-4" />
        </button>
      </td>
    </tr>
  );
}

function UserDetailPanel({
  user,
  busy,
  onClose,
  onEdit,
  onStatus,
  onViewSeries,
  onAssignSeries,
}: {
  user: ManagedUserProjection | null;
  busy: boolean;
  onClose: () => void;
  onEdit: (user: ManagedUserProjection) => void;
  onStatus: (
    user: ManagedUserProjection,
    status: Extract<ManagedUserStatus, "active" | "suspended">,
  ) => void;
  onViewSeries: (user: ManagedUserProjection) => void;
  onAssignSeries: (user: ManagedUserProjection) => void;
}) {
  return (
    <DetailPanel>
      <DetailPanelHeader>
        <div className="flex items-center justify-between gap-3">
          <h2 className="m-0 text-base font-semibold text-text">
            Detalles del usuario
          </h2>
          <button
            aria-label="Cerrar detalle"
            type="button"
            className="grid size-8 place-items-center rounded-control border border-[var(--border-subtle)] text-secondary hover:bg-surface-hover"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </DetailPanelHeader>
      <DetailPanelContent>
        {user ? (
          <div className="grid gap-4">
            <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 overflow-hidden">
              <div className="grid size-14 shrink-0 place-items-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
                {initials(user.discordUsername ?? user.email)}
              </div>
              <div className="min-w-0 overflow-hidden">
                <p className="relative m-0 min-w-0 overflow-hidden whitespace-nowrap text-base font-semibold text-text">
                  <span className="block truncate pr-7">
                    {user.discordUsername ?? user.email}
                  </span>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-surface to-transparent"
                  />
                </p>
                <UserStatusBadge status={user.status} />
              </div>
            </div>
            <Meta label="Correo electrónico">
              <EmailValue email={user.email} />
            </Meta>
            <Meta label="Rol">
              <RoleBadge role={user.role ?? "uploader"} />
            </Meta>
            <Meta label="Series asignadas">
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-sm text-text">
                  {user.assignedSeriesCount}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="shrink-0 whitespace-nowrap"
                  onClick={() => onViewSeries(user)}
                  icon={
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  }
                >
                  Ver series
                </Button>
              </div>
            </Meta>
            <Meta label="Último acceso" value={formatDate(user.lastAccessAt)} />
            <Meta
              label="Fecha de registro"
              value={formatDate(user.createdAt)}
            />
          </div>
        ) : (
          <div className="grid h-full min-h-64 place-items-center text-center text-secondary">
            <p className="m-0">Selecciona un usuario para ver sus detalles.</p>
          </div>
        )}
      </DetailPanelContent>
      {user ? (
        <DetailPanelActions>
          {user.status === "pending" ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => onStatus(user, "active")}
              icon={<Check aria-hidden="true" className="size-4" />}
            >
              Aprobar usuario
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={busy}
            variant={user.status === "pending" ? "secondary" : "primary"}
            onClick={() => onEdit(user)}
            icon={<Pencil aria-hidden="true" className="size-4" />}
          >
            Editar usuario
          </Button>
          {user.status === "active" && user.role === "uploader" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onAssignSeries(user)}
              icon={<ListChecks aria-hidden="true" className="size-4" />}
            >
              Asignar series
            </Button>
          ) : null}
          {user.status === "active" ? (
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => onStatus(user, "suspended")}
              icon={<PauseCircle aria-hidden="true" className="size-4" />}
            >
              Desactivar usuario
            </Button>
          ) : user.status === "suspended" ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onStatus(user, "active")}
              icon={<UserRoundCheck aria-hidden="true" className="size-4" />}
            >
              Reactivar usuario
            </Button>
          ) : null}
        </DetailPanelActions>
      ) : null}
    </DetailPanel>
  );
}

function Meta({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  return (
    <div className="grid gap-1 border-t border-[var(--border-subtle)] pt-3">
      <p className="m-0 text-xs uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      {children ?? <p className="m-0 text-sm text-text">{value ?? "—"}</p>}
    </div>
  );
}

function EmailValue({ email }: { email: string }) {
  const { copy, state } = useCopyToClipboard();
  const copied = state === "copied";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <p className="relative m-0 min-w-0 flex-1 overflow-hidden whitespace-nowrap text-sm text-text">
        <span className="block truncate pr-6">{email}</span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-surface to-transparent"
        />
      </p>
      <button
        aria-label={copied ? "Correo copiado" : "Copiar correo electrónico"}
        className="grid size-8 shrink-0 place-items-center rounded-control border border-[var(--border-subtle)] bg-surface text-secondary transition-colors hover:bg-surface-hover hover:text-text"
        type="button"
        onClick={() => void copy(email)}
      >
        {copied ? (
          <Check aria-hidden="true" className="size-4 text-success" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? "Correo copiado" : ""}
      </span>
    </div>
  );
}
function RoleBadge({ role }: { role: ManagedUserRole }) {
  return (
    <StatusBadge
      label={
        role === "admin"
          ? "Administrador"
          : role === "gestor"
            ? "Gestor"
            : "Uploader"
      }
      tone={role === "admin" ? "info" : role === "gestor" ? "warning" : "info"}
    />
  );
}
function UserStatusBadge({ status }: { status: ManagedUserStatus }) {
  const presentation =
    status === "active"
      ? { label: "Activo", tone: "success" as const }
      : status === "suspended"
        ? { label: "Suspendido", tone: "danger" as const }
        : status === "pending"
          ? { label: "Pendiente", tone: "warning" as const }
          : { label: "Rechazado", tone: "neutral" as const };
  return <StatusBadge label={presentation.label} tone={presentation.tone} />;
}
function initials(value: string) {
  return value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("es-PE", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(date);
}

function UserSeriesDialog({
  open,
  onOpenChange,
  user,
  mode,
  series,
  loading,
  busy,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: ManagedUserProjection | null;
  mode: "view" | "assign";
  series: readonly SeriesListProjection[];
  loading: boolean;
  busy: boolean;
  onSave: (seriesIds: readonly string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const assigned = useMemo(
    () => series.filter((item) => item.responsibleUser?.id === user?.id),
    [series, user?.id],
  );
  const assignedIds = useMemo(
    () => assigned.map((item) => item.id),
    [assigned],
  );

  useEffect(() => {
    if (!open || mode !== "assign") return;
    setSearch("");
    setSelectedIds(new Set(assignedIds));
  }, [open, mode, assignedIds]);

  const displayed = (mode === "view" ? assigned : series).filter((item) =>
    `${item.title} ${item.slug}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const toggle = (seriesId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(seriesId)) next.delete(seriesId);
      else next.add(seriesId);
      return next;
    });
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === "assign" ? "Asignar series" : "Series asignadas"}
      {...(user
        ? {
            description: `${user.discordUsername ?? user.email} · ${
              mode === "assign"
                ? "La actualización se aplicará de forma atómica."
                : "Responsabilidades actuales del usuario."
            }`,
          }
        : {})}
      size="lg"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          {mode === "assign" ? (
            <Button
              type="button"
              loading={busy}
              onClick={() => onSave([...selectedIds])}
            >
              Guardar asignaciones
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-3">
        <SearchInput
          placeholder="Buscar series…"
          value={search}
          onChange={setSearch}
        />
        {loading ? (
          <p className="m-0 py-8 text-center text-sm text-secondary">
            Cargando series…
          </p>
        ) : !displayed.length ? (
          <div className="rounded-control border border-dashed border-[var(--border-subtle)] bg-surface px-4 py-10 text-center text-sm text-secondary">
            {mode === "view"
              ? "Este usuario no tiene Series asignadas."
              : "No hay Series que coincidan con la búsqueda."}
          </div>
        ) : (
          <ul className="m-0 max-h-[420px] list-none overflow-y-auto rounded-control border border-[var(--border-subtle)] bg-surface p-1">
            {displayed.map((item) => {
              const checked = selectedIds.has(item.id);
              return (
                <li
                  key={item.id}
                  className="flex min-h-16 items-center gap-3 rounded-control px-2 py-2 hover:bg-surface-hover"
                >
                  {mode === "assign" ? (
                    <input
                      aria-label={`Asignar ${item.title}`}
                      checked={checked}
                      className="size-4 shrink-0 accent-primary"
                      type="checkbox"
                      onChange={() => toggle(item.id)}
                    />
                  ) : null}
                  <ContentImage
                    alt={`Portada de ${item.title}`}
                    src={item.coverUrl}
                    variant="thumbnail"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="m-0 truncate text-sm font-medium text-text">
                      {item.title}
                    </p>
                    <p className="m-0 truncate text-xs text-secondary">
                      {item.slug}
                    </p>
                  </div>
                  <Link
                    className="inline-flex min-h-8 items-center gap-1 rounded-control border border-[var(--border-subtle)] bg-surface px-2.5 text-xs font-medium text-text hover:bg-surface-hover"
                    href={`/series/${item.id}`}
                  >
                    Ver serie
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppDialog>
  );
}
