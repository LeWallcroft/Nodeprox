"use client";

import { Images, Pencil, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { hasCapability } from "../../../lib/auth/visibility";
import type {
  Chapter,
  ChapterInput,
} from "../../../lib/domains/chapters/types";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { ConfirmationDialog } from "../../ui/confirmation-dialog";
import { EmptyState } from "../../ui/empty-state";
import { StatusBadge } from "../../ui/status-badge";
import { UploadForm } from "../uploads/upload-form";
import { ChapterForm } from "./chapter-form";

function toneForStatus(status: Chapter["status"]) {
  if (status === "ready") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "processing") return "info" as const;
  if (status === "deleting") return "warning" as const;
  return "neutral" as const;
}

export function ChapterDetailPanel({
  chapter,
  capabilities,
  onClose,
  onUpdate,
  onDelete,
  updatePending = false,
  deletePending = false,
}: {
  chapter: Chapter | null;
  capabilities: readonly string[] | undefined;
  onClose: () => void;
  onUpdate: (input: ChapterInput) => Promise<void>;
  onDelete: () => Promise<void>;
  updatePending?: boolean;
  deletePending?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  if (!chapter)
    return (
      <EmptyState
        title="Selecciona un Chapter"
        description="El detalle y las acciones disponibles aparecerán aquí."
      />
    );

  const canEdit = hasCapability(capabilities, "chapters.edit");
  const canDelete = hasCapability(capabilities, "chapters.delete");
  const canUpload = hasCapability(capabilities, "images.upload");
  const deleting = chapter.status === "deleting";

  async function remove() {
    setActionError(null);
    try {
      await onDelete();
    } catch {
      setActionError("No se pudo solicitar la eliminación del Chapter.");
    }
  }

  return (
    <Card className="max-h-full overflow-y-auto xl:sticky xl:top-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Capítulo seleccionado
          </p>
          <h2 className="mb-0 mt-1 text-xl font-semibold">
            Capítulo {chapter.chapterNumber}
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
      <dl className="mt-5 grid gap-4 text-sm">
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Estado
          </dt>
          <dd className="mt-1">
            <StatusBadge
              label={chapter.status}
              tone={toneForStatus(chapter.status)}
            />
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Clave pública
          </dt>
          <dd className="mt-1 font-semibold">{chapter.publicKey}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
            Título
          </dt>
          <dd className="mt-1 text-muted">{chapter.title || "Sin título."}</dd>
        </div>
      </dl>
      {deleting ? (
        <p
          className="mt-5 rounded-control bg-warning-soft p-3 text-sm text-warning"
          role="status"
        >
          La eliminación está en curso. El contenido deja de estar operativo
          mientras el backend finaliza la limpieza.
        </p>
      ) : null}
      {actionError ? (
        <p className="mt-4 text-sm text-danger" role="alert">
          {actionError}
        </p>
      ) : null}
      <div className="mt-5 grid gap-2">
        {canEdit && !deleting ? (
          <Button type="button" onClick={() => setEditing((value) => !value)}>
            <Pencil aria-hidden="true" className="size-4" /> Editar capítulo
          </Button>
        ) : null}
        <Link
          className="inline-flex min-h-control items-center justify-center gap-2 rounded-control border border-border bg-surface-elevated px-3.5 font-medium text-text hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          href={`/series/${chapter.seriesId}/chapters/${chapter.id}/images`}
        >
          <Images aria-hidden="true" className="size-4" /> Gestionar capítulo
        </Link>
        {canUpload && !deleting ? (
          <Button
            className="w-full"
            type="button"
            onClick={() => setUploading(true)}
          >
            <Upload aria-hidden="true" className="size-4" /> Subir ZIP
          </Button>
        ) : null}
        {canDelete && !deleting ? (
          <Button
            variant="destructive"
            type="button"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 aria-hidden="true" className="size-4" /> Eliminar capítulo
          </Button>
        ) : null}
      </div>
      <AppDialog
        busy={updatePending}
        description="El número y la clave pública son estables en el contrato actual."
        open={editing}
        title="Editar capítulo"
        onOpenChange={setEditing}
      >
        <ChapterForm
          initial={chapter}
          editableNumber={false}
          submitLabel="Guardar cambios"
          onSubmit={async (input) => {
            await onUpdate(input);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </AppDialog>
      <AppDialog
        open={uploading}
        title={`Subir ZIP del capítulo ${chapter.chapterNumber}`}
        description="Sube el archivo ZIP con las imágenes de este capítulo."
        onOpenChange={setUploading}
      >
        <UploadForm
          seriesId={chapter.seriesId}
          chapterId={chapter.id}
          onSuccess={() => setUploading(false)}
        />
      </AppDialog>
      <ConfirmationDialog
        confirmLabel="Solicitar eliminación"
        description="El capítulo pasará a eliminación y el backend finalizará la limpieza de contenido."
        error={actionError}
        open={confirmingDelete}
        pending={deletePending}
        title="¿Eliminar capítulo?"
        onOpenChange={(open) => {
          setConfirmingDelete(open);
          if (!open) setActionError(null);
        }}
        onConfirm={() => void remove().then(() => setConfirmingDelete(false))}
      />
    </Card>
  );
}
