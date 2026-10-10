"use client";

import { useEffect, useState } from "react";
import type { UploadCenterRecord } from "../../../lib/domains/uploads/upload-center-view-model";

export function uploadOutcomeMessage(record: UploadCenterRecord) {
  if (record.status === "ready" || record.status === "completed") {
    return record.warningCount > 0
      ? {
          title: "Carga completada con advertencias",
          copy: `La carga finalizó y se detectaron ${record.warningCount} advertencias.`,
          tone: "warning" as const,
          detail: true,
        }
      : {
          title:
            record.kind === "chapter_replacement" ||
            record.kind === "image_replacement"
              ? "Reemplazo completado"
              : "Carga completada",
          copy:
            record.kind === "chapter_replacement"
              ? "El capítulo se reemplazó correctamente."
              : record.kind === "image_replacement"
                ? "La imagen se reemplazó correctamente."
                : "El capítulo se cargó correctamente.",
          tone: "success" as const,
          detail: false,
        };
  }
  if (record.status === "rejected")
    return {
      title: "Carga rechazada",
      copy: "La carga no superó las validaciones.",
      tone: "error" as const,
      detail: true,
    };
  if (record.status === "retry_exhausted")
    return {
      title: "Carga interrumpida",
      copy: "La operación agotó sus intentos automáticos y requiere atención.",
      tone: "error" as const,
      detail: true,
    };
  return {
    title: "La carga no pudo completarse",
    copy: record.errorCode
      ? "La operación se detuvo por un error que requiere atención."
      : "No se pudo completar la operación.",
    tone: "error" as const,
    detail: true,
  };
}

export function uploadBatchOutcomePresentation(summary: {
  completed: number;
  warnings: number;
  rejected: number;
  failed: number;
}) {
  return {
    title: "Carga masiva completada",
    copy: [
      `${summary.completed} capítulos completados`,
      `${summary.warnings} con advertencias`,
      `${summary.rejected} ${summary.rejected === 1 ? "rechazado" : "rechazados"}`,
      ...(summary.failed ? [`${summary.failed} con error`] : []),
    ].join(" · "),
    tone: (summary.rejected || summary.failed
      ? "error"
      : summary.warnings
        ? "warning"
        : "success") as "error" | "warning" | "success",
  };
}

export function UploadOutcomeMessage({
  operation,
  batchSummary,
  onDismiss,
  onDetails,
  onCenter,
  onRetry,
}: {
  operation: UploadCenterRecord;
  batchSummary?: {
    completed: number;
    warnings: number;
    rejected: number;
    failed: number;
  };
  onDismiss(): void;
  onDetails(): void;
  onCenter?(): void;
  onRetry?(): void;
}) {
  const message = batchSummary
    ? {
        ...uploadBatchOutcomePresentation(batchSummary),
        detail: false,
      }
    : uploadOutcomeMessage(operation);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(
      onDismiss,
      message.tone === "success" ? 6000 : 12000,
    );
    return () => window.clearTimeout(timer);
  }, [message.tone, onDismiss, paused]);
  return (
    <article
      role={message.tone === "error" ? "alert" : "status"}
      className="rounded-control border border-[var(--border-subtle)] bg-surface-elevated p-3 shadow-panel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setPaused(false);
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="m-0 text-sm font-semibold text-text">{message.title}</p>
          <p className="m-0 mt-1 text-sm text-secondary">{message.copy}</p>
        </div>
        <button
          type="button"
          aria-label="Cerrar notificación"
          className="text-secondary"
          onClick={onDismiss}
        >
          ×
        </button>
      </div>
      <div className="mt-2 flex gap-3 text-sm">
        {batchSummary && onCenter ? (
          <button
            type="button"
            className="text-primary underline"
            onClick={onCenter}
          >
            Ver Centro de cargas
          </button>
        ) : null}
        {!batchSummary && message.detail ? (
          <button
            type="button"
            className="text-primary underline"
            onClick={onDetails}
          >
            Ver detalles
          </button>
        ) : null}
        {operation.status === "retry_exhausted" && onRetry ? (
          <button
            type="button"
            className="text-primary underline"
            onClick={onRetry}
          >
            Reintentar
          </button>
        ) : null}
      </div>
    </article>
  );
}
