"use client";

import {
  CheckCircle2,
  FileArchive,
  LoaderCircle,
  Replace,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { useWholeChapterReplacement } from "../../../lib/domains/chapter-replacements/hooks";
import type { WholeChapterReplacementPhase } from "../../../lib/domains/chapter-replacements/types";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { ZipDropzone } from "../uploads/zip-dropzone";

export function WholeChapterReplacementDialog({
  open,
  onOpenChange,
  chapterId,
  chapterNumber,
  seriesId,
  seriesTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chapterId: string;
  chapterNumber: number;
  seriesId: string;
  seriesTitle: string;
}) {
  const workflow = useWholeChapterReplacement({ chapterId, seriesId });
  const [file, setFile] = useState<File | null>(null);
  const active = workflow.isActive;
  const processingFailed = workflow.projection?.status === "failed";

  function selectFile(files: File[]) {
    const selected = files[0];
    if (!selected) return;
    if (workflow.phase === "failed" || workflow.phase === "completed")
      workflow.reset();
    setFile(selected);
    workflow.select();
  }

  function close() {
    onOpenChange(false);
    if (!active) {
      setFile(null);
      workflow.reset();
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title="Cambiar capítulo entero"
      description={`Capítulo ${chapterNumber} · ${seriesTitle}`}
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={close}>
            {workflow.phase === "completed" ? "Cerrar" : "Cancelar"}
          </Button>
          {workflow.phase !== "completed" ? (
            <Button
              type="button"
              disabled={!file || active}
              aria-busy={active}
              onClick={() => file && void workflow.start(file)}
            >
              {active ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin"
                />
              ) : (
                <Replace aria-hidden="true" className="size-4" />
              )}
              {actionLabel(workflow.phase)}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="rounded-control border border-warning/50 bg-warning-soft p-3 text-sm text-text">
          <p className="m-0 font-medium">
            El nuevo ZIP sustituirá todas las imágenes actuales del capítulo.
          </p>
          <p className="mb-0 mt-2 text-muted">
            Las imágenes publicadas se actualizarán únicamente cuando el nuevo
            capítulo haya sido procesado correctamente.
          </p>
          <p className="mb-0 mt-2 text-muted">
            Si contiene menos imágenes, las imágenes sobrantes actuales dejarán
            de formar parte del capítulo publicado.
          </p>
        </div>

        {workflow.phase !== "completed" ? (
          <ZipDropzone
            mode="single"
            disabled={active}
            selectedFiles={file ? [file] : []}
            onFilesSelected={selectFile}
          />
        ) : null}

        {active ? (
          <div
            className="flex items-center gap-3 rounded-control border border-primary bg-primary-soft p-3 text-sm"
            role="status"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-5 shrink-0 animate-spin text-primary"
            />
            <div>
              <p className="m-0 font-medium text-text">
                {statusLabel(workflow.phase)}
              </p>
              <p className="mb-0 mt-1 text-muted">
                Puedes cerrar esta ventana; el proceso continuará en el
                servidor.
              </p>
            </div>
          </div>
        ) : null}

        {workflow.phase === "completed" && workflow.projection?.result ? (
          <div
            className="flex gap-3 rounded-control border border-success/50 bg-success-soft p-3 text-sm"
            role="status"
          >
            <CheckCircle2
              aria-hidden="true"
              className="size-5 shrink-0 text-success"
            />
            <div>
              <p className="m-0 font-medium text-text">
                Capítulo actualizado correctamente.
              </p>
              <p className="mb-0 mt-1 text-muted">
                {workflow.projection.result.imageCount} imágenes publicadas ·{" "}
                {workflow.projection.result.createdImageCount} nuevas ·{" "}
                {workflow.projection.result.retiredImageCount} retiradas
              </p>
            </div>
          </div>
        ) : null}

        {workflow.phase === "failed" ? (
          <div
            className="flex gap-3 rounded-control border border-danger/50 bg-danger-soft p-3 text-sm"
            role="alert"
          >
            <XCircle
              aria-hidden="true"
              className="size-5 shrink-0 text-danger"
            />
            <div>
              <p className="m-0 font-medium text-text">
                {processingFailed
                  ? "No se pudo procesar el capítulo"
                  : "No se pudo iniciar el reemplazo del capítulo."}
              </p>
              <p className="mb-0 mt-1 text-muted">
                {processingFailed
                  ? failureMessage(workflow.projection?.errorCode)
                  : "Comprueba tu conexión e inténtalo nuevamente."}
              </p>
            </div>
          </div>
        ) : null}

        {file && workflow.phase === "selected" ? (
          <div className="flex items-center gap-2 text-sm text-muted">
            <FileArchive aria-hidden="true" className="size-4" /> {file.name}
          </div>
        ) : null}
      </div>
    </AppDialog>
  );
}

function actionLabel(phase: WholeChapterReplacementPhase): string {
  if (phase === "uploading") return "Subiendo…";
  if (phase === "processing") return "Procesando…";
  if (phase === "applying") return "Aplicando…";
  if (phase === "failed") return "Intentar con un nuevo ZIP";
  return "Cambiar capítulo";
}

function statusLabel(phase: WholeChapterReplacementPhase): string {
  if (phase === "uploading") return "Preparando carga";
  if (phase === "processing") return "Procesando capítulo";
  return "Aplicando cambios";
}

function failureMessage(errorCode?: string): string {
  if (errorCode === "invalid-zip-archive" || errorCode === "invalid-zip-layout")
    return "El ZIP no es válido.";
  if (errorCode?.includes("unsupported") || errorCode?.includes("image-magic"))
    return "El ZIP contiene un formato de imagen no compatible.";
  if (errorCode?.includes("size") || errorCode?.includes("limit"))
    return "El archivo supera los límites permitidos.";
  return "Vuelve a intentarlo con un nuevo archivo ZIP.";
}
