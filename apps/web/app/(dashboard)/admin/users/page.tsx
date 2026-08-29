"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Pencil,
  ShieldOff,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { errorMessage } from "../../../../components/domains/feedback";
import { PageHeader } from "../../../../components/layout/page-header";
import { AppDialog } from "../../../../components/ui/app-dialog";
import { Button } from "../../../../components/ui/button";
import { ConfirmationDialog } from "../../../../components/ui/confirmation-dialog";
import { DataTable } from "../../../../components/ui/data-table";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { LoadingState } from "../../../../components/ui/loading-state";
import { SearchInput } from "../../../../components/ui/search-input";
import { StatusBadge } from "../../../../components/ui/status-badge";
import {
  useManagedUsers,
  useReviewManagedUser,
} from "../../../../lib/domains/users/hooks";
import type {
  ManagedUser,
  ManagedUserRole,
  ManagedUserStatus,
} from "../../../../lib/domains/users/types";

const filters: Array<{ value: "all" | ManagedUserStatus; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "active", label: "Activos" },
  { value: "suspended", label: "Suspendidos" },
];

export default function AdminUsersPage() {
  const users = useManagedUsers();
  const review = useReviewManagedUser();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | ManagedUserStatus>("all");
  const [roleUser, setRoleUser] = useState<ManagedUser | null>(null);
  const [role, setRole] = useState<ManagedUserRole>("uploader");
  const [confirmation, setConfirmation] = useState<{
    user: ManagedUser;
    status: Extract<ManagedUserStatus, "active" | "rejected" | "suspended">;
    label: string;
  } | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (users.data ?? []).filter((user) => {
      if (filter !== "all" && user.status !== filter) return false;
      return (
        !needle ||
        `${user.discordUsername ?? ""} ${user.email}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    });
  }, [filter, query, users.data]);

  async function submitStatus() {
    if (!confirmation) return;
    await review.mutateAsync({
      userId: confirmation.user.id,
      input: { status: confirmation.status },
    });
    setConfirmation(null);
  }

  async function submitRole() {
    if (!roleUser) return;
    await review.mutateAsync({
      userId: roleUser.id,
      input: {
        status:
          roleUser.status === "suspended"
            ? "active"
            : (roleUser.status as "active"),
        role,
      },
    });
    setRoleUser(null);
  }

  return (
    <>
      <PageHeader
        title="Usuarios"
        description="Gestiona la aprobación, el estado y el rol global de las cuentas."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administración", href: "/admin" },
          { label: "Usuarios", current: true },
        ]}
      />
      <div className="mb-section flex flex-wrap gap-2">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Buscar por usuario Discord o email"
        />
        <select
          aria-label="Filtrar usuarios por estado"
          value={filter}
          onChange={(event) => setFilter(event.target.value as typeof filter)}
        >
          {filters.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
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
      {users.isSuccess && !visible.length ? (
        <EmptyState
          title="No hay usuarios"
          description="No hay cuentas que coincidan con los filtros actuales."
        />
      ) : null}
      {users.isSuccess && visible.length ? (
        <DataTable label="Usuarios">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted">
              <th className="px-4 py-3">Usuario Discord</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Rol</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Registro</th>
              <th className="px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                busy={review.isPending}
                onApprove={() =>
                  setConfirmation({ user, status: "active", label: "Aprobar" })
                }
                onReject={() =>
                  setConfirmation({
                    user,
                    status: "rejected",
                    label: "Rechazar",
                  })
                }
                onSuspend={() =>
                  setConfirmation({
                    user,
                    status: "suspended",
                    label: "Suspender",
                  })
                }
                onReactivate={() =>
                  setConfirmation({
                    user,
                    status: "active",
                    label: "Reactivar",
                  })
                }
                onRole={() => {
                  setRoleUser(user);
                  setRole(user.role ?? "uploader");
                }}
              />
            ))}
          </tbody>
        </DataTable>
      ) : null}
      <AppDialog
        open={Boolean(roleUser)}
        onOpenChange={(open) => {
          if (!open) setRoleUser(null);
        }}
        title="Cambiar rol"
        {...(roleUser ? { description: roleUser.email } : {})}
        busy={review.isPending}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              type="button"
              disabled={review.isPending}
              onClick={() => setRoleUser(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={review.isPending}
              onClick={() => void submitRole()}
            >
              Guardar
            </Button>
          </div>
        }
      >
        <label className="grid gap-1.5 text-sm font-medium text-secondary">
          Rol
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as ManagedUserRole)}
          >
            <option value="admin">Admin</option>
            <option value="gestor">Gestor</option>
            <option value="uploader">Uploader</option>
          </select>
        </label>
      </AppDialog>
      <ConfirmationDialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
        title={`${confirmation?.label ?? "Confirmar"} usuario`}
        description={`Esta acción cambiará el estado de ${confirmation?.user.email ?? "este usuario"}.`}
        confirmLabel={confirmation?.label ?? "Confirmar"}
        pending={review.isPending}
        onConfirm={submitStatus}
      />
    </>
  );
}

function UserRow({
  user,
  busy,
  onApprove,
  onReject,
  onSuspend,
  onReactivate,
  onRole,
}: {
  user: ManagedUser;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSuspend: () => void;
  onReactivate: () => void;
  onRole: () => void;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-3 text-sm">{user.discordUsername ?? "—"}</td>
      <td className="px-4 py-3 text-sm">{user.email}</td>
      <td className="px-4 py-3 text-sm">{user.role ?? "uploader"}</td>
      <td className="px-4 py-3">
        <StatusBadge
          label={user.status}
          tone={
            user.status === "active"
              ? "success"
              : user.status === "pending"
                ? "warning"
                : "danger"
          }
        />
      </td>
      <td className="px-4 py-3 text-sm text-secondary">
        {new Intl.DateTimeFormat("es", { dateStyle: "medium" }).format(
          new Date(user.createdAt),
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          {user.status === "pending" ? (
            <>
              <Button type="button" disabled={busy} onClick={onApprove}>
                <Check aria-hidden="true" className="size-4" />
                Aprobar
              </Button>
              <Button
                variant="destructive"
                type="button"
                disabled={busy}
                onClick={onReject}
              >
                <UserRoundX aria-hidden="true" className="size-4" />
                Rechazar
              </Button>
            </>
          ) : null}
          {user.status === "active" ? (
            <>
              <Button
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={onRole}
              >
                <Pencil aria-hidden="true" className="size-4" />
                Cambiar rol
              </Button>
              <Button
                variant="destructive"
                type="button"
                disabled={busy}
                onClick={onSuspend}
              >
                <ShieldOff aria-hidden="true" className="size-4" />
                Suspender
              </Button>
            </>
          ) : null}
          {user.status === "suspended" ? (
            <Button type="button" disabled={busy} onClick={onReactivate}>
              <UserRoundCheck aria-hidden="true" className="size-4" />
              Reactivar
            </Button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
