"use client";

import {
  Images,
  Library,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
  UserRoundPlus,
  X,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { hasCapability } from "../../../lib/auth/visibility";
import type {
  Chapter,
  ChapterInput,
  GlobalChapter,
} from "../../../lib/domains/chapters/types";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { ConfirmationDialog } from "../../ui/confirmation-dialog";
import {
  DetailPanel,
  DetailPanelActions,
  DetailPanelContent,
  DetailPanelHeader,
} from "../../ui/detail-panel";
import { EmptyState } from "../../ui/empty-state";
import { StatusBadge } from "../../ui/status-badge";
import { UploadForm } from "../uploads/upload-form";
import { ChapterForm } from "./chapter-form";
import { WholeChapterReplacementDialog } from "./whole-chapter-replacement-dialog";

function toneForStatus(status: Chapter["status"]) {
  if (status === "ready") return "success" as const;
  if (status === "failed") return "danger" as const;
  if (status === "processing") return "info" as const;
  if (status === "deleting") return "warning" as const;
  return "neutral" as const;
}

function DetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
        {label}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

export function ChapterDetailPanel({
  chapter,
  globalChapter,
  capabilities,
  onClose,
  onUpdate,
  onDelete,
  onAssignCollaborator,
  updatePending = false,
  deletePending = false,
  seriesTitle,
  showSeriesLink = true,
  showMetricsPlaceholder: _showMetricsPlaceholder = false,
}: {
  chapter: Chapter | null;
  globalChapter?: GlobalChapter | null;
  capabilities: readonly string[] | undefined;
  onClose: () => void;
  onUpdate: (input: ChapterInput) => Promise<void>;
  onDelete: () => Promise<void>;
  onAssignCollaborator?: (() => void) | undefined;
  updatePending?: boolean;
  deletePending?: boolean;
  seriesTitle?: string;
  showSeriesLink?: boolean;
  showMetricsPlaceholder?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  if (!chapter)
    return (
      <DetailPanel>
        <DetailPanelContent>
          <EmptyState
            title="Selecciona un capítulo"
            description="El detalle y las acciones disponibles aparecerán aquí."
          />
        </DetailPanelContent>
      </DetailPanel>
    );

  const canEdit = hasCapability(capabilities, "chapters.edit");
  const canDelete = hasCapability(capabilities, "chapters.delete");
  const canUpload = hasCapability(capabilities, "images.upload");
  const canReplace = hasCapability(capabilities, "chapters.replace");
  const canAssign = hasCapability(capabilities, "chapters.helper.grant");
  const deleting = chapter.status === "deleting";
  const series = globalChapter?.series;
  const responsible = globalChapter?.responsibleUser;
  const hasExistingImages =
    (globalChapter?.imageCount ?? 0) > 0 || chapter.status === "ready";
  async function remove() {
    setActionError(null);
    try {
      await onDelete();
    } catch {
      setActionError("No se pudo solicitar la eliminación del capítulo.");
    }
  }

  return (
    <DetailPanel>
      <DetailPanelHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="m-0 text-base font-semibold">
              Detalles del capítulo
            </h2>
            <p className="mb-0 mt-1 text-sm text-muted">
              Capítulo {chapter.chapterNumber}
            </p>
          </div>
          <button
            aria-label="Cerrar detalle"
            className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-border bg-surface-elevated text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            type="button"
            onClick={onClose}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      </DetailPanelHeader>
      <DetailPanelContent>
        <dl className="grid gap-4 text-sm">
          <DetailField label="Serie">
            <span className="font-medium">
              {series?.title ?? seriesTitle ?? "Sin serie"}
            </span>
            <span className="mt-0.5 block text-xs text-muted">
              {series?.slug}
            </span>
            {showSeriesLink ? (
              <Link
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                href={`/series/${chapter.seriesId}/chapters`}
              >
                <Library aria-hidden="true" className="size-4" /> Ver serie
              </Link>
            ) : null}
          </DetailField>
          <DetailField label="Número de capítulo">
            <span className="font-medium">{chapter.chapterNumber}</span>
          </DetailField>
          <DetailField label="Estado">
            <StatusBadge
              label={chapter.status}
              tone={toneForStatus(chapter.status)}
            />
          </DetailField>
          <DetailField label="Imágenes">
            <span className="font-medium">
              {globalChapter?.imageCount ?? 0}
            </span>
          </DetailField>
          <DetailField label="Última actualización">
            <span className="text-muted">
              {new Date(chapter.updatedAt).toLocaleString("es-PE")}
            </span>
          </DetailField>
          <DetailField label="Responsable">
            <span className="text-muted">
              {responsible?.email ?? "Sin responsable asignado"}
            </span>
          </DetailField>
          <DetailField label="Descripción">
            <span className="text-muted">
              {chapter.title || "Sin descripción."}
            </span>
          </DetailField>
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
        {hasExistingImages ? (
          <p
            className="mt-4 rounded-control border border-[var(--border-subtle)] bg-warning-soft p-3 text-sm text-warning"
            role="status"
          >
            Este capítulo ya contiene imágenes. Para reemplazarlas, utiliza la
            acción Cambiar capítulo.
          </p>
        ) : null}
        {actionError ? (
          <p className="mt-4 text-sm text-danger" role="alert">
            {actionError}
          </p>
        ) : null}
      </DetailPanelContent>
      <DetailPanelActions>
        {canEdit && !deleting ? (
          <Button
            variant="secondary"
            type="button"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" className="size-4" /> Editar capítulo
          </Button>
        ) : null}
        <Link
          className="inline-flex min-h-control items-center justify-center gap-2 rounded-control border border-transparent bg-primary px-3.5 font-medium text-primary-foreground shadow-card hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          href={`/series/${chapter.seriesId}/chapters/${chapter.id}/images`}
        >
          <Images aria-hidden="true" className="size-4" /> Gestionar capítulo
        </Link>
        {canUpload && !hasExistingImages && !deleting ? (
          <Button
            variant="secondary"
            type="button"
            onClick={() => setUploading(true)}
          >
            <Upload aria-hidden="true" className="size-4" /> Subir ZIP
          </Button>
        ) : null}
        {canAssign && !deleting && onAssignCollaborator ? (
          <Button
            variant="secondary"
            type="button"
            onClick={onAssignCollaborator}
          >
            <UserRoundPlus aria-hidden="true" className="size-4" /> Asignar
            colaborador
          </Button>
        ) : null}
        {canReplace &&
        hasExistingImages &&
        (series || seriesTitle) &&
        !deleting ? (
          <Button
            variant="secondary"
            type="button"
            onClick={() => setReplacing(true)}
          >
            <RefreshCw aria-hidden="true" className="size-4" /> Cambiar capítulo
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
      </DetailPanelActions>
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
      {series || seriesTitle ? (
        <WholeChapterReplacementDialog
          chapterId={chapter.id}
          chapterNumber={chapter.chapterNumber}
          open={replacing}
          seriesId={chapter.seriesId}
          seriesTitle={series?.title ?? seriesTitle ?? "Serie"}
          onOpenChange={setReplacing}
        />
      ) : null}
    </DetailPanel>
  );
}
