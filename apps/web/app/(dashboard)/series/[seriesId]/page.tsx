"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil, Trash2, UserRoundPlus } from "lucide-react";
import { PageHeader } from "../../../../components/layout/page-header";
import { SeriesForm } from "../../../../components/domains/series/series-form";
import { SeriesCoverPreview } from "../../../../components/domains/series/series-cover-preview";
import { AssignSeriesUserDialog } from "../../../../components/domains/series/assign-series-user-dialog";
import { errorMessage } from "../../../../components/domains/feedback";
import { Button } from "../../../../components/ui/button";
import { AppDialog } from "../../../../components/ui/app-dialog";
import { ConfirmationDialog } from "../../../../components/ui/confirmation-dialog";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { Skeleton } from "../../../../components/ui/skeleton";
import {
  useDeleteSeries,
  useAssignSeriesUploader,
  useClearSeriesUploader,
  useSeries,
  useSeriesCapabilities,
  useUpdateSeries,
  useSeriesUploaderCandidates,
} from "../../../../lib/domains/series/hooks";
import { hasCapability } from "../../../../lib/auth/visibility";
import type { SeriesInput } from "../../../../lib/domains/series/types";

export default function SeriesDetailPage() {
  const params = useParams<{ seriesId: string }>();
  const router = useRouter();
  const seriesId = params.seriesId;
  const query = useSeries(seriesId);
  const capabilities = useSeriesCapabilities(seriesId);
  const update = useUpdateSeries(seriesId);
  const remove = useDeleteSeries();
  const [editing, setEditing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const canManageAssignment = hasCapability(
    capabilities.data?.capabilities,
    "series.assignment.manage",
  );
  const candidates = useSeriesUploaderCandidates(seriesId, canManageAssignment);
  const assignUploader = useAssignSeriesUploader(seriesId);
  const clearUploader = useClearSeriesUploader(seriesId);

  async function handleUpdate(input: SeriesInput) {
    await update.mutateAsync({
      title: input.title,
      description: input.description ?? null,
      coverUrl: input.coverUrl ?? null,
    });
    setEditing(false);
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await remove.mutateAsync(seriesId);
      router.push("/series");
    } catch (cause) {
      setActionError(errorMessage(cause));
    }
  }

  if (query.isPending)
    return (
      <section className="grid gap-3 rounded-xl border border-border bg-surface p-5">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </section>
    );
  if (query.isError)
    return (
      <ErrorState
        title="No se pudo cargar la Series"
        description={errorMessage(query.error)}
        action={
          <Button type="button" onClick={() => void query.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  if (!query.data)
    return (
      <EmptyState
        title="Series no encontrada"
        description="La Series solicitada ya no está disponible."
      />
    );
  const series = query.data;
  const canEdit = hasCapability(capabilities.data?.capabilities, "series.edit");
  const canDelete = hasCapability(
    capabilities.data?.capabilities,
    "series.delete",
  );
  return (
    <>
      <PageHeader
        title={series.title}
        description={series.description || "Sin descripción."}
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Series", href: "/series" },
          { label: series.title, current: true },
        ]}
        back={{ label: "Volver a Series", href: "/series" }}
        actions={
          <div className="flex gap-2">
            {canEdit ? (
              <Button
                type="button"
                onClick={() => setEditing((value) => !value)}
              >
                <Pencil aria-hidden="true" className="size-4" />
                {editing ? "Cerrar edición" : "Editar"}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                variant="destructive"
                type="button"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 aria-hidden="true" className="size-4" /> Eliminar serie
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
            {canManageAssignment && series.principalUploader ? (
              <Button
                className="border-border bg-surface-elevated text-text hover:bg-hover"
                type="button"
                disabled={clearUploader.isPending}
                onClick={() => setConfirmingClear(true)}
              >
                Quitar responsable
              </Button>
            ) : null}
          </div>
        }
      />
      {actionError ? (
        <p className="mb-section text-[13px] text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      <AppDialog
        busy={update.isPending}
        description="El slug público es estable y no se puede modificar desde esta acción."
        open={editing}
        title="Editar serie"
        onOpenChange={setEditing}
      >
        <SeriesForm
          initial={series}
          showSlug={false}
          submitLabel="Guardar cambios"
          onSubmit={handleUpdate}
          onCancel={() => setEditing(false)}
        />
      </AppDialog>
      <section className="grid gap-card md:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            Slug
          </span>
          <p className="mb-0 mt-2 font-semibold">{series.slug}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <SeriesCoverPreview coverUrl={series.coverUrl} title={series.title} />
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            Responsable principal
          </span>
          <p className="mb-0 mt-2 text-muted">
            {series.principalUploader?.email ?? "Sin responsable asignado."}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">
            Chapters
          </span>
          <p className="mb-0 mt-2">
            <Link
              className="font-semibold text-primary underline-offset-4 hover:underline"
              href={`/series/${series.id}/chapters`}
            >
              Abrir capítulos
            </Link>
          </p>
        </div>
      </section>
      <AssignSeriesUserDialog
        open={assigning}
        series={series}
        candidates={candidates.data}
        isLoading={candidates.isPending}
        error={candidates.error instanceof Error ? candidates.error : null}
        isSubmitting={assignUploader.isPending}
        onClose={() => setAssigning(false)}
        onAssign={async (uploaderId) => {
          await assignUploader.mutateAsync(uploaderId);
          setAssigning(false);
        }}
      />
      <ConfirmationDialog
        confirmLabel="Eliminar serie"
        description="Esta acción elimina la serie si no tiene Chapters asociados y no se puede deshacer."
        error={actionError}
        open={confirmingDelete}
        pending={remove.isPending}
        title="¿Eliminar serie?"
        onOpenChange={(open) => {
          setConfirmingDelete(open);
          if (!open) setActionError(null);
        }}
        onConfirm={() => void handleDelete()}
      />
      <ConfirmationDialog
        confirmLabel="Quitar responsable"
        description="La serie quedará sin uploader principal hasta una nueva asignación."
        error={actionError}
        open={confirmingClear}
        pending={clearUploader.isPending}
        title="¿Quitar responsable?"
        onOpenChange={(open) => {
          setConfirmingClear(open);
          if (!open) setActionError(null);
        }}
        onConfirm={() => {
          setActionError(null);
          void clearUploader
            .mutateAsync()
            .then(() => setConfirmingClear(false))
            .catch((cause: unknown) => setActionError(errorMessage(cause)));
        }}
      />
    </>
  );
}
