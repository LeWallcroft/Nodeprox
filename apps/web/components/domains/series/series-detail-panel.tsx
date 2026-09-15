"use client";

import {
  ChartNoAxesColumn,
  Images,
  Pencil,
  Trash2,
  UserRoundPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { hasCapability } from "../../../lib/auth/visibility";
import type {
  Series,
  SeriesInput,
  SeriesResponsibleCandidate,
} from "../../../lib/domains/series/types";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { ConfirmationDialog } from "../../ui/confirmation-dialog";
import { ContentImage } from "../../ui/content-image";
import { CopyButton } from "../../ui/copy-button";
import { EmptyState } from "../../ui/empty-state";
import { StatusBadge } from "../../ui/status-badge";
import { AssignSeriesUserDialog } from "./assign-series-user-dialog";
import { ManageSeriesHelpersDialog } from "./manage-series-helpers-dialog";
import { SeriesForm } from "./series-form";

export function SeriesDetailPanel({
  series,
  capabilities,
  onClose,
  onUpdate,
  onDelete,
  candidates,
  candidatesLoading,
  candidatesError,
  assignmentPending,
  onAssignResponsible,
  updatePending,
  deletePending,
}: {
  series: Series | null;
  capabilities: readonly string[] | undefined;
  onClose: () => void;
  onUpdate: (
    input: Pick<SeriesInput, "title" | "description" | "coverUrl">,
  ) => Promise<void>;
  onDelete: () => Promise<void>;
  candidates: readonly SeriesResponsibleCandidate[] | undefined;
  candidatesLoading: boolean;
  candidatesError: Error | null;
  assignmentPending: boolean;
  onAssignResponsible: (responsibleUserId: string) => Promise<void>;
  updatePending: boolean;
  deletePending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [managingHelpers, setManagingHelpers] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  if (!series)
    return (
      <EmptyState
        title="Selecciona una Series"
        description="El detalle y las acciones disponibles aparecerán aquí."
      />
    );

  const canEdit = hasCapability(capabilities, "series.edit");
  const canDelete = hasCapability(capabilities, "series.delete");
  const canCreateChapter = hasCapability(capabilities, "chapters.create");
  const canViewChapters = hasCapability(capabilities, "series.read");
  const canManageAssignment = hasCapability(
    capabilities,
    "series.assignment.manage",
  );
  const canManageHelpers =
    hasCapability(capabilities, "chapters.helper.grant") ||
    hasCapability(capabilities, "chapters.helper.revoke");

  return (
    <Card className="h-full overflow-y-auto p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="m-0 text-base font-semibold">Detalle de la serie</h2>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-border bg-surface-elevated text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          type="button"
          aria-label="Cerrar detalle"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="mt-4 flex items-start gap-3">
        <ContentImage
          alt={`Portada de ${series.title}`}
          src={series.coverUrl}
          variant="details"
        />
        <div className="min-w-0">
          <h3 className="m-0 truncate text-lg font-semibold">{series.title}</h3>
          <div className="mt-2">
            <StatusBadge label="Activa" tone="success" />
          </div>
          <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Slug
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="break-all text-sm font-medium text-text">
              {series.slug}
            </span>
            <CopyButton
              className="min-h-8 px-2 text-xs"
              label="Copiar slug"
              value={series.slug}
            />
          </div>
        </div>
      </div>
      <dl className="mt-4 grid gap-3 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Estado
          </dt>
          <dd className="mt-1 text-muted">Activa</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Responsable
          </dt>
          <dd className="mt-1 text-muted">
            {series.responsibleUser?.email ?? "Sin responsable asignado."}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Canal Discord
          </dt>
          <dd className="mt-1 text-muted">
            {series.discordChannelId
              ? series.discordChannelNameSnapshot
                ? `#${series.discordChannelNameSnapshot}`
                : "Canal vinculado"
              : "Sin canal vinculado."}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Creada
          </dt>
          <dd className="mt-1 text-muted">
            {new Date(series.createdAt).toLocaleString("es-PE")}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Descripción
          </dt>
          <dd className="mt-1 text-muted">
            {series.description || "Sin descripción."}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Actualizada
          </dt>
          <dd className="mt-1 text-muted">
            {new Date(series.updatedAt).toLocaleString("es-PE")}
          </dd>
        </div>
      </dl>
      <div className="mt-4 grid gap-2">
        {canViewChapters ? (
          <Link
            className="inline-flex min-h-control items-center justify-center gap-2 rounded-control border border-transparent bg-primary px-3.5 font-medium text-primary-foreground shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            href={`/series/${series.id}/chapters`}
          >
            <Images aria-hidden="true" className="size-4" />
            {canCreateChapter ? "Gestionar capítulos" : "Ver capítulos"}
          </Link>
        ) : null}
        {canEdit ? (
          <Button type="button" onClick={() => setEditing((value) => !value)}>
            <Pencil aria-hidden="true" className="size-4" />
            {editing ? "Cerrar edición" : "Editar serie"}
          </Button>
        ) : null}
        {canManageAssignment ? (
          <Button type="button" onClick={() => setAssigning(true)}>
            <UserRoundPlus aria-hidden="true" className="size-4" />
            {series.responsibleUser
              ? "Cambiar responsable"
              : "Asignar responsable"}
          </Button>
        ) : null}
        {canManageHelpers ? (
          <Button type="button" onClick={() => setManagingHelpers(true)}>
            <UserRoundPlus aria-hidden="true" className="size-4" /> Gestionar
            colaboradores
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            variant="destructive"
            type="button"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 aria-hidden="true" className="size-4" />
            Eliminar serie
          </Button>
        ) : null}
      </div>
      <section className="mt-4 rounded-control border border-border bg-surface-elevated p-3 text-muted">
        <ChartNoAxesColumn aria-hidden="true" className="size-5" />
        <h3 className="mb-1 mt-2 text-sm font-semibold text-text">Métricas</h3>
        <p className="mb-1 text-sm font-medium">Muy pronto</p>
        <p className="mb-0 text-xs">Disponible en una próxima versión.</p>
      </section>
      <AppDialog
        busy={updatePending}
        description="El slug público es estable y no se puede modificar desde esta acción."
        open={editing}
        title="Editar serie"
        onOpenChange={setEditing}
      >
        <SeriesForm
          initial={series}
          submitLabel="Guardar cambios"
          onSubmit={async (input) => {
            await onUpdate({
              title: input.title,
              description: input.description ?? null,
              coverUrl: input.coverUrl ?? null,
            });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </AppDialog>
      <AssignSeriesUserDialog
        open={assigning}
        series={series}
        candidates={candidates}
        isLoading={candidatesLoading}
        error={candidatesError}
        isSubmitting={assignmentPending}
        onClose={() => setAssigning(false)}
        onAssign={async (responsibleUserId) => {
          await onAssignResponsible(responsibleUserId);
          setAssigning(false);
        }}
      />
      {managingHelpers ? (
        <ManageSeriesHelpersDialog
          open
          series={series}
          onClose={() => setManagingHelpers(false)}
        />
      ) : null}
      <ConfirmationDialog
        confirmLabel="Eliminar serie"
        description="Esta acción elimina la serie si no tiene Chapters asociados y no se puede deshacer."
        error={deleteError}
        open={confirmingDelete}
        pending={deletePending}
        title="¿Eliminar serie?"
        onOpenChange={(open) => {
          setConfirmingDelete(open);
          if (!open) setDeleteError(null);
        }}
        onConfirm={() => {
          setDeleteError(null);
          void onDelete()
            .then(() => setConfirmingDelete(false))
            .catch((cause: unknown) =>
              setDeleteError(
                cause instanceof Error
                  ? cause.message
                  : "No se pudo eliminar la serie.",
              ),
            );
        }}
      />
    </Card>
  );
}
