"use client";

import {
  CircleAlert,
  CircleCheckBig,
  CircleX,
  ExternalLink,
  Eye,
  FileArchive,
  Files,
  HardDrive,
  Image,
  Replace,
  TriangleAlert,
  UploadCloud,
  X,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
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
      copy: `La carga no superó las validaciones. Se encontraron ${record.issueCount} problemas.`,
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
      title="Resultado de carga"
      size="md"
      chrome="soft"
      geometry="compact-stable"
      footer={
        <div className="flex min-h-10 flex-wrap items-center justify-end gap-2">
          {result.details ? (
            <button
              type="button"
              className={`inline-flex items-center justify-center gap-2 rounded-control px-3 py-2 text-sm ${operation.status !== "rejected" && result.tone === "warning" ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "text-primary hover:bg-surface-hover"}`}
              onClick={closeForDetails}
            >
              <Eye aria-hidden="true" className="size-4" />
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
              className="inline-flex items-center justify-center gap-2 rounded-control bg-primary px-3 py-2 text-sm text-primary-foreground hover:bg-primary-hover"
              href={`/series/${operation.seriesId}/chapters`}
              onClick={() => onOpenChange(false)}
            >
              <UploadCloud aria-hidden="true" className="size-4" />
              Subir ZIP corregido
            </Link>
          ) : result.tone === "warning" || result.tone === "danger" ? (
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-control px-3 py-2 text-sm text-secondary hover:bg-surface-hover"
              onClick={() => {
                onOpenChange(false);
                onCenter();
              }}
            >
              <UploadCloud aria-hidden="true" className="size-4" />
              Ir al Centro de cargas
            </button>
          ) : (
            <Link
              className={`inline-flex items-center justify-center gap-2 rounded-control px-3 py-2 text-sm ${result.tone === "success" ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "text-secondary hover:bg-surface-hover"}`}
              href={chapterHref}
              onClick={() => onOpenChange(false)}
            >
              <ExternalLink aria-hidden="true" className="size-4" />
              Ver en capítulos
            </Link>
          )}
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-control px-3 py-2 text-sm text-secondary hover:bg-surface-hover"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" className="size-4" />
            Cerrar
          </button>
        </div>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-5">
        <div
          className={`flex items-start gap-3 rounded-control p-4 ${resultToneClass(result.tone)}`}
        >
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-full ${resultHeroIconClass(result.tone)}`}
          >
            {result.tone === "success" ? (
              <CircleCheckBig aria-hidden="true" className="size-6" />
            ) : operation.status === "retry_exhausted" ? (
              <CircleAlert
                aria-hidden="true"
                className="size-6"
                data-testid="result-icon-attention"
              />
            ) : result.tone === "warning" ? (
              <TriangleAlert
                aria-hidden="true"
                className="size-6"
                data-testid="result-icon-warning"
              />
            ) : (
              <CircleX aria-hidden="true" className="size-6" />
            )}
          </span>
          <div>
            <h3
              className={`m-0 text-base font-semibold ${resultTitleToneClass(result.tone)}`}
            >
              {result.title}
            </h3>
            <p className="m-0 mt-1 text-sm text-secondary">{result.copy}</p>
          </div>
        </div>
        <div className="rounded-control bg-surface p-4">
          <div className="flex items-center gap-3">
            <span
              className={`grid size-10 shrink-0 place-items-center rounded-full ${resultMetadataIconClass(result.tone)}`}
            >
              {resultOperationIcon(operation.kind)}
            </span>
            <div className="min-w-0">
              <p className="m-0 truncate font-semibold text-text">
                {operation.chapterNumber === null
                  ? operation.seriesTitle
                  : `Capítulo ${operation.chapterNumber} · ${operation.seriesTitle}`}
              </p>
              <p className="m-0 mt-1 break-all text-sm text-secondary">
                {operation.filename}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {operation.fileCount !== null ? (
              <ResultMetric
                icon={<Files aria-hidden="true" className="size-5" />}
                label="Archivos"
                value={String(operation.fileCount)}
                tone={result.tone}
              />
            ) : null}
            {operation.totalSizeBytes !== null ? (
              <ResultMetric
                icon={<HardDrive aria-hidden="true" className="size-5" />}
                label="Tamaño total"
                value={formatMiB(operation.totalSizeBytes)}
                tone="neutral"
              />
            ) : null}
            {operation.warningCount > 0 ? (
              <ResultMetric
                icon={<TriangleAlert aria-hidden="true" className="size-5" />}
                label="Advertencias"
                value={String(operation.warningCount)}
                tone="warning"
              />
            ) : operation.status === "rejected" && operation.issueCount > 0 ? (
              <ResultMetric
                icon={<CircleX aria-hidden="true" className="size-5" />}
                label="Problemas encontrados"
                value={String(operation.issueCount)}
                tone="danger"
              />
            ) : result.tone === "success" ? (
              <ResultMetric
                icon={<CircleCheckBig aria-hidden="true" className="size-5" />}
                label="Validación"
                value="Sin incidencias"
                tone="success"
              />
            ) : null}
          </div>
          {operation.warningCount > 0 || operation.status === "rejected" ? (
            <div
              className={`mt-3 flex items-start gap-3 rounded-control p-3 ${resultSummaryClass(operation.status === "rejected" ? "danger" : "warning")}`}
            >
              {result.tone === "warning" ? (
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0"
                />
              ) : (
                <CircleX
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0"
                />
              )}
              <p className="m-0 text-xs">
                {operation.status === "rejected"
                  ? "Corrige los problemas indicados en el detalle y vuelve a subir el ZIP."
                  : "Las advertencias no impiden la carga, pero se recomienda revisarlas."}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </AppDialog>
  );
}

function ResultMetric({
  icon,
  label,
  value,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  return (
    <div className="flex items-center gap-3 px-2 py-1">
      <span className={resultMetricToneClass(tone)}>{icon}</span>
      <span className="min-w-0 flex-1 text-sm text-secondary">{label}</span>
      <span
        className={`shrink-0 text-sm font-semibold ${resultMetricValueClass(tone)}`}
      >
        {value}
      </span>
    </div>
  );
}

function resultMetricToneClass(
  tone: "success" | "warning" | "danger" | "neutral",
) {
  return {
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive-text",
    neutral: "text-secondary",
  }[tone];
}

function resultMetricValueClass(
  tone: "success" | "warning" | "danger" | "neutral",
) {
  return {
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive-text",
    neutral: "text-text",
  }[tone];
}

function resultMetadataIconClass(tone: "success" | "warning" | "danger") {
  return {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive-surface text-destructive-text",
  }[tone];
}

function resultSummaryClass(tone: "warning" | "danger") {
  return {
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive-surface text-destructive-text",
  }[tone];
}

function resultHeroIconClass(tone: "success" | "warning" | "danger") {
  return {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive-surface text-destructive-text",
  }[tone];
}

function resultTitleToneClass(tone: "success" | "warning" | "danger") {
  return {
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive-text",
  }[tone];
}

function resultOperationIcon(kind: UploadCenterRecord["kind"]): ReactNode {
  if (kind === "chapter_replacement")
    return <Replace aria-hidden="true" className="size-5" />;
  if (kind === "image_replacement")
    return <Image aria-hidden="true" className="size-5" />;
  return <FileArchive aria-hidden="true" className="size-5" />;
}

function resultToneClass(tone: "success" | "warning" | "danger") {
  return {
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive-surface text-destructive-text",
  }[tone];
}

function formatMiB(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}
