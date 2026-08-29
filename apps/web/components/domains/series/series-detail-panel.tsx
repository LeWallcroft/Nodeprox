"use client";

import Link from "next/link";
import { useState } from "react";
import { Images, Pencil, Trash2, UserRoundPlus, X } from "lucide-react";
import { hasCapability } from "../../../lib/auth/visibility";
import type {
  Series,
  SeriesInput,
  SeriesUploaderCandidate,
} from "../../../lib/domains/series/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { EmptyState } from "../../ui/empty-state";
import { SeriesForm } from "./series-form";
import { SeriesCoverPreview } from "./series-cover-preview";
import { AssignSeriesUserDialog } from "./assign-series-user-dialog";
import { AppDialog } from "../../ui/app-dialog";
import { ConfirmationDialog } from "../../ui/confirmation-dialog";
import { ManageSeriesHelpersDialog } from "./manage-series-helpers-dialog";

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
  onAssignUploader,
  onClearUploader,
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
  candidates: readonly SeriesUploaderCandidate[] | undefined;
  candidatesLoading: boolean;
  candidatesError: Error | null;
  assignmentPending: boolean;
  onAssignUploader: (uploaderId: string) => Promise<void>;
  onClearUploader: () => Promise<void>;
  updatePending: boolean;
  deletePending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [managingHelpers, setManagingHelpers] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);
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
    <Card className="max-h-full overflow-y-auto xl:sticky xl:top-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Series seleccionada
          </p>
          <h2 className="mb-0 mt-1 truncate text-xl font-semibold">
            {series.title}
          </h2>
        </div>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-border bg-surface-elevated text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          type="button"
          aria-label="Cerrar detalle"
          onClick={onClose}
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="mt-5">
        <SeriesCoverPreview coverUrl={series.coverUrl} title={series.title} />
      </div>
      <dl className="mt-5 grid gap-4 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Slug público
          </dt>
          <dd className="mt-1 break-all font-semibold">{series.slug}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Responsable principal
          </dt>
          <dd className="mt-1 text-muted">
            {series.principalUploader?.email ?? "Sin responsable asignado."}
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
      <div className="mt-5 grid gap-2">
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
            {editing ? "Cerrar edición" : "Editar series"}
          </Button>
        ) : null}
        {canManageAssignment ? (
          <Button type="button" onClick={() => setAssigning(true)}>
            <UserRoundPlus aria-hidden="true" className="size-4" />
            {series.principalUploader
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
        {canManageAssignment && series.principalUploader ? (
          <Button
            variant="destructive"
            type="button"
            disabled={assignmentPending}
            onClick={() => setConfirmingClear(true)}
          >
            Quitar responsable
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
      {assignmentError ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {assignmentError}
        </p>
      ) : null}
      <AppDialog
        busy={updatePending}
        description="El slug público es estable y no se puede modificar desde esta acción."
        open={editing}
        title="Editar serie"
        onOpenChange={setEditing}
      >
        <SeriesForm
          initial={series}
          showSlug={false}
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
        onAssign={async (uploaderId) => {
          await onAssignUploader(uploaderId);
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
        confirmLabel="Quitar responsable"
        description="La serie quedará sin uploader principal hasta una nueva asignación."
        error={assignmentError}
        open={confirmingClear}
        pending={assignmentPending}
        title="¿Quitar responsable?"
        onOpenChange={(open) => {
          setConfirmingClear(open);
          if (!open) setAssignmentError(null);
        }}
        onConfirm={() => {
          setAssignmentError(null);
          void onClearUploader()
            .then(() => setConfirmingClear(false))
            .catch((cause: unknown) =>
              setAssignmentError(
                cause instanceof Error
                  ? cause.message
                  : "No se pudo quitar el responsable.",
              ),
            );
        }}
      />
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
