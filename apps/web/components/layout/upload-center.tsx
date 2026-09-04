"use client";

import {
  CheckCheck,
  FileArchive,
  LoaderCircle,
  RefreshCw,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ImportBatchProjection } from "../../lib/domains/ingestion/types";
import {
  type UploadCenterBatch,
  useUploadQueue,
} from "../providers/upload-queue-provider";
import { Button } from "../ui/button";
import { ProgressBar } from "../ui/progress-bar";
import { StatusBadge } from "../ui/status-badge";

export function UploadCenter() {
  const [open, setOpen] = useState(false);
  const [dismissedCompletedBatchIds, setDismissedCompletedBatchIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [refreshing, setRefreshing] = useState(false);
  const queue = useUploadQueue();
  const visibleBatches = useMemo(
    () =>
      queue.batches.filter(
        (batch) =>
          !dismissedCompletedBatchIds.has(batch.batchId) ||
          !isReadyBatch(batch),
      ),
    [dismissedCompletedBatchIds, queue.batches],
  );
  const readyBatchIds = visibleBatches
    .filter(isReadyBatch)
    .map((batch) => batch.batchId);
  const count = queue.batches.reduce(
    (total, batch) =>
      total +
      (batch.projection?.items.filter((item) => isActiveItem(item.status))
        .length ?? 0),
    0,
  );

  useEffect(() => {
    setDismissedCompletedBatchIds((current) => {
      const next = new Set(
        [...current].filter((batchId) => {
          const batch = queue.batches.find(
            (candidate) => candidate.batchId === batchId,
          );
          return Boolean(batch && isReadyBatch(batch));
        }),
      );
      return next.size === current.size ? current : next;
    });
  }, [queue.batches]);

  async function refresh() {
    setRefreshing(true);
    try {
      await queue.refresh();
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <div className="fixed bottom-4 right-4 z-30 max-[767px]:bottom-3 max-[767px]:right-3">
      {open ? (
        <section
          aria-label="Centro de cargas"
          className="absolute bottom-[calc(100%+0.75rem)] right-0 w-[min(30rem,calc(100vw-1.5rem))] rounded-panel border border-border bg-surface-elevated p-4 shadow-panel"
        >
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="m-0 text-base font-semibold text-text">
                Centro de cargas
              </h2>
              <p className="m-0 text-xs text-secondary">
                El seguimiento continúa mientras navegas. Al cerrar el
                navegador, una transferencia directa puede requerir reintento.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                aria-label="Actualizar"
                title="Actualizar"
                type="button"
                variant="secondary"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={`size-4 ${refreshing ? "animate-spin" : ""}`}
                />
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={!readyBatchIds.length}
                onClick={() =>
                  setDismissedCompletedBatchIds(
                    (current) => new Set([...current, ...readyBatchIds]),
                  )
                }
              >
                <CheckCheck aria-hidden="true" className="size-4" />
                Limpiar completadas
              </Button>
              <Button
                aria-label="Cerrar centro de cargas"
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </div>
          </div>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
            {visibleBatches.length ? (
              visibleBatches.map((batch) => (
                <section
                  key={batch.batchId}
                  className="rounded-control border border-border bg-surface p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Link
                      className="truncate text-sm font-semibold text-text hover:text-primary"
                      href={`/series/${batch.seriesId}/chapters`}
                    >
                      {batch.seriesTitle}
                    </Link>
                    <span className="shrink-0 text-xs text-muted">
                      {batch.projection?.status ?? "Cargando…"}
                    </span>
                  </div>
                  {batch.projection ? (
                    <div className="space-y-2">
                      {batch.projection.items.map((item) => (
                        <UploadCenterItem
                          key={item.itemId}
                          batchId={batch.batchId}
                          seriesId={batch.seriesId}
                          item={item}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 text-sm text-secondary">
                      Recuperando el estado persistido…
                    </p>
                  )}
                </section>
              ))
            ) : (
              <p className="m-0 py-4 text-center text-sm text-secondary">
                No hay cargas activas
              </p>
            )}
          </div>
        </section>
      ) : null}
      <Button type="button" onClick={() => setOpen((value) => !value)}>
        {queue.activeTransfers ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Upload aria-hidden="true" className="size-4" />
        )}
        Cargas{count ? ` (${count})` : ""}
      </Button>
    </div>
  );
}

export function isReadyBatch(batch: UploadCenterBatch) {
  return (
    batch.projection?.status === "completed" &&
    batch.projection.items.every((item) => item.status === "ready")
  );
}

export function isActiveItem(status: string) {
  return !["ready", "failed"].includes(status);
}

function UploadCenterItem({
  batchId,
  seriesId,
  item,
}: {
  batchId: string;
  seriesId: string;
  item: ImportBatchProjection["items"][number];
}) {
  const queue = useUploadQueue();
  const input = useRef<HTMLInputElement>(null);
  const progress = queue.progressFor(batchId, item.itemId);
  const canRetry = item.status === "failed";
  const canAbort =
    item.status === "uploading" && Boolean(item.chapterId && item.uploadId);
  return (
    <article className="grid gap-1 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-sm text-text">
          <FileArchive aria-hidden="true" className="size-4 shrink-0" />
          <span className="truncate">{item.filename}</span>
        </span>
        <StatusBadge
          label={statusLabel(item.status)}
          tone={statusTone(item.status)}
        />
      </div>
      <p className="m-0 text-xs text-secondary">
        Capítulo {item.chapterNumber}
        {item.resolution ? ` · ${resolutionLabel(item.resolution)}` : ""}
      </p>
      {item.status === "uploading" && progress !== undefined ? (
        <ProgressBar value={progress} />
      ) : null}
      {item.errorCode ? (
        <p className="m-0 text-xs text-danger">{errorLabel(item.errorCode)}</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        {item.chapterId ? (
          <Link
            className="text-xs font-medium text-primary hover:text-primary-hover"
            href={`/series/${seriesId}/chapters`}
          >
            Ver capítulo
          </Link>
        ) : null}
        {canRetry ? (
          <>
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void queue.retryWithFile({
                    batchId,
                    seriesId,
                    itemId: item.itemId,
                    file,
                  });
                event.currentTarget.value = "";
              }}
            />
            <button
              className="text-xs font-medium text-primary hover:text-primary-hover"
              type="button"
              onClick={() => input.current?.click()}
            >
              Reintentar ZIP
            </button>
          </>
        ) : null}
        {canAbort && item.chapterId && item.uploadId ? (
          <button
            className="text-xs font-medium text-secondary hover:text-text"
            type="button"
            onClick={() =>
              void queue.abortTransfer({
                batchId,
                chapterId: item.chapterId as string,
                uploadId: item.uploadId as string,
              })
            }
          >
            Cancelar transferencia
          </button>
        ) : null}
      </div>
    </article>
  );
}

function statusLabel(status: string) {
  return (
    {
      pending: "Pendiente",
      uploading: "Subiendo",
      uploaded: "Subido",
      processing: "Procesando",
      ready: "Listo",
      failed: "Error",
    }[status] ?? status
  );
}

function statusTone(status: string) {
  return status === "ready"
    ? "success"
    : status === "failed"
      ? "danger"
      : status === "pending"
        ? "neutral"
        : "info";
}

function resolutionLabel(resolution: string) {
  return (
    {
      created: "Capítulo creado",
      reused: "Capítulo reutilizado",
      conflict: "Conflicto de capítulo",
    }[resolution] ?? resolution
  );
}

function errorLabel(code: string) {
  return (
    {
      "chapter-upload-active": "El capítulo ya tiene una carga activa.",
      "chapter-processing": "El capítulo se está procesando.",
      "bulk-item-limit": "El batch supera el máximo de 15 ZIP.",
    }[code] ?? code
  );
}
