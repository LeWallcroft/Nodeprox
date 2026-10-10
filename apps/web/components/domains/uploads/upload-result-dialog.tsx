"use client";

import Link from "next/link";
import type { UploadCenterRecord } from "../../../lib/domains/uploads/upload-center-view-model";
import { AppDialog } from "../../ui/app-dialog";

export function uploadResultPresentation(record: UploadCenterRecord) {
  if (record.status === "ready" || record.status === "completed") {
    if (record.warningCount > 0)
      return {
        title: "Carga completada con advertencias",
        copy: `La carga finalizó correctamente. Se detectaron ${record.warningCount} advertencias. Las advertencias no impidieron la carga, pero se recomienda revisarlas.`,
        tone: "warning" as const,
        details: true,
      };
    if (record.kind === "chapter_replacement")
      return {
        title: "Reemplazo completado",
        copy: "El capítulo se reemplazó correctamente.",
        tone: "success" as const,
        details: false,
      };
    if (record.kind === "image_replacement")
      return {
        title: "Reemplazo completado",
        copy: "La imagen se reemplazó correctamente.",
        tone: "success" as const,
        details: false,
      };
    return {
      title: "Carga completada",
      copy: "El capítulo se cargó correctamente.",
      tone: "success" as const,
      details: false,
    };
  }
  if (record.status === "rejected")
    return {
      title: "Carga rechazada",
      copy: `La carga no superó las validaciones. Se encontraron ${record.issueCount} problemas. Corrige los archivos indicados y vuelve a subir el ZIP.`,
      tone: "danger" as const,
      details: true,
    };
  if (record.status === "retry_exhausted")
    return {
      title: "Carga interrumpida",
      copy: "La operación agotó sus intentos automáticos y requiere atención. El archivo original se conserva.",
      tone: "warning" as const,
      details: true,
    };
  return {
    title: "La carga no pudo completarse",
    copy: "La operación se detuvo por un problema que requiere atención.",
    tone: "danger" as const,
    details: Boolean(record.errorCode || record.failureStage),
  };
}

export function UploadResultDialog({
  open,
  operation,
  onOpenChange,
  onDetails,
  onCenter,
}: {
  open: boolean;
  operation: UploadCenterRecord | null;
  onOpenChange(open: boolean): void;
  onDetails(): void;
  onCenter(): void;
}) {
  if (!operation) return null;
  const result = uploadResultPresentation(operation);
  const chapterHref = operation.chapterId
    ? operation.kind === "image_replacement"
      ? `/series/${operation.seriesId}/chapters/${operation.chapterId}/images`
      : `/series/${operation.seriesId}/chapters`
    : `/series/${operation.seriesId}/chapters`;
  const closeForDetails = () => {
    onOpenChange(false);
    onDetails();
  };
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={result.title}
      size="md"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {result.details ? (
            <button
              type="button"
              className="rounded-control border border-[var(--border-subtle)] px-3 py-2 text-sm text-primary hover:bg-surface-hover"
              onClick={closeForDetails}
            >
              Ver detalle
              {operation.status === "rejected" && operation.issueCount
                ? ` (${operation.issueCount})`
                : operation.warningCount
                  ? ` (${operation.warningCount})`
                  : ""}
            </button>
          ) : null}
          {operation.status === "rejected" ? (
            <Link
              className="rounded-control bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary-hover"
              href={`/series/${operation.seriesId}/chapters`}
              onClick={() => onOpenChange(false)}
            >
              Subir ZIP corregido
            </Link>
          ) : result.tone === "warning" || result.tone === "danger" ? (
            <button
              type="button"
              className="rounded-control border border-[var(--border-subtle)] px-3 py-2 text-sm"
              onClick={() => {
                onOpenChange(false);
                onCenter();
              }}
            >
              Ir al Centro de cargas
            </button>
          ) : (
            <Link
              className="rounded-control border border-[var(--border-subtle)] px-3 py-2 text-sm"
              href={chapterHref}
              onClick={() => onOpenChange(false)}
            >
              Ver en capítulos
            </Link>
          )}
          <button
            type="button"
            className="rounded-control bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary-hover"
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </button>
        </div>
      }
    >
      <div
        className={`rounded-control border p-4 ${resultToneClass(result.tone)}`}
      >
        <p className="m-0 text-sm">{result.copy}</p>
      </div>
      <div className="mt-4 rounded-control border border-[var(--border-subtle)] bg-surface p-4">
        <p className="m-0 font-semibold text-text">
          {operation.chapterNumber === null
            ? operation.seriesTitle
            : `Capítulo ${operation.chapterNumber} · ${operation.seriesTitle}`}
        </p>
        <p className="m-0 mt-1 break-all text-sm text-secondary">
          {operation.filename}
        </p>
        {operation.fileCount !== null || operation.totalSizeBytes !== null ? (
          <p className="m-0 mt-2 text-sm text-secondary">
            {operation.fileCount === null
              ? ""
              : `${operation.fileCount} archivos`}
            {operation.fileCount !== null && operation.totalSizeBytes !== null
              ? " · "
              : ""}
            {operation.totalSizeBytes === null
              ? ""
              : formatMiB(operation.totalSizeBytes)}
          </p>
        ) : null}
        <p className="m-0 mt-2 text-xs text-secondary">
          {operation.status === "ready" || operation.status === "completed"
            ? "Operación completada"
            : operation.status === "rejected"
              ? "Corrige los archivos indicados en el detalle."
              : "Consulta el Centro de cargas para revisar el estado."}
        </p>
      </div>
    </AppDialog>
  );
}

function resultToneClass(tone: "success" | "warning" | "danger") {
  return {
    success: "border-success/30 bg-success/5 text-success",
    warning: "border-warning/40 bg-warning/5 text-warning-text",
    danger:
      "border-destructive/30 bg-destructive-surface text-destructive-text",
  }[tone];
}

function formatMiB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
