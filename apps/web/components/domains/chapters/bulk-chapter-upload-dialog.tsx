"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileArchive, Upload, X } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../feedback";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { ProgressBar } from "../../ui/progress-bar";
import { StatusBadge } from "../../ui/status-badge";
import { queryKeys } from "../../../lib/domains/query-keys";
import { parseChapterNumber } from "../../../lib/domains/chapters/chapter-number";
import {
  abortImportItem,
  completeImportItem,
  createImportBatch,
  getImportBatch,
  retryImportItem,
} from "../../../lib/domains/ingestion/api";
import {
  mediaWarningLabel,
  runPool,
  safeBulkUploadConcurrency,
} from "../../../lib/domains/ingestion/orchestration";
import { useProductSettings } from "../../../lib/domains/settings/hooks";
import type { ImportCandidate } from "../../../lib/domains/ingestion/types";
import { putDirectUpload } from "../../../lib/domains/uploads/api";

export function BulkChapterUploadDialog({
  open,
  onOpenChange,
  seriesId,
  seriesTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesId: string;
  seriesTitle: string;
}) {
  const queryClient = useQueryClient();
  const settings = useProductSettings();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = useMemo(
    () =>
      items.length > 0 &&
      items.every(
        (item) =>
          item.chapterNumber !== null &&
          Number.isFinite(item.chapterNumber) &&
          item.chapterNumber >= 0 &&
          item.file.size > 0,
      ) &&
      new Set(items.map((item) => item.chapterNumber)).size === items.length,
    [items],
  );

  useEffect(() => {
    if (!batchId || running) return;
    const timer = window.setInterval(
      () =>
        void getImportBatch(batchId)
          .then((projection) => {
            setItems((current) =>
              current.map((item) => {
                const projected = projection.items.find(
                  (candidate) => candidate.clientId === item.clientId,
                );
                if (!projected) return item;
                const next: ImportCandidate = {
                  ...item,
                  itemId: projected.itemId,
                  status: projected.status,
                  warnings: projected.warnings,
                };
                if (projected.chapterId) next.chapterId = projected.chapterId;
                else delete next.chapterId;
                if (projected.uploadId) next.uploadId = projected.uploadId;
                else delete next.uploadId;
                if (projected.errorCode) next.error = projected.errorCode;
                else delete next.error;
                return next;
              }),
            );
            if (
              projection.status === "completed" ||
              projection.status === "completed_with_errors"
            )
              void queryClient.invalidateQueries({
                queryKey: queryKeys.series.chapters(seriesId),
              });
          })
          .catch(() => undefined),
      2000,
    );
    return () => window.clearInterval(timer);
  }, [batchId, queryClient, running, seriesId]);

  function update(clientId: string, mutation: Partial<ImportCandidate>) {
    setItems((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...mutation } : item,
      ),
    );
  }
  function select(files: FileList | null) {
    if (!files) return;
    const selected = Array.from(files)
      .filter(isZipFile)
      .map((file) => ({
        clientId: crypto.randomUUID(),
        file,
        chapterNumber: inferChapterNumber(file.name),
        status: "pending" as const,
        progress: 0,
      }));
    setItems(selected);
    setBatchId(null);
    setError(
      selected.length ? null : "Selecciona uno o más archivos ZIP válidos.",
    );
  }
  async function transfer(
    candidate: ImportCandidate,
    session: {
      chapterId: string;
      uploadId: string;
      transfer: Parameters<typeof putDirectUpload>[1];
    },
  ) {
    update(candidate.clientId, {
      chapterId: session.chapterId,
      uploadId: session.uploadId,
      status: "uploading",
      progress: 0,
    });
    setItems((current) =>
      current.map((item) => {
        if (item.clientId !== candidate.clientId || !item.error) return item;
        const next = { ...item };
        delete next.error;
        return next;
      }),
    );
    try {
      await putDirectUpload(candidate.file, session.transfer, (progress) =>
        update(candidate.clientId, {
          progress: Math.round(
            (progress.loadedBytes / progress.totalBytes) * 100,
          ),
        }),
      );
      await completeImportItem(session.chapterId, session.uploadId);
      update(candidate.clientId, { status: "uploaded", progress: 100 });
    } catch (cause) {
      await abortImportItem(session.chapterId, session.uploadId).catch(
        () => undefined,
      );
      update(candidate.clientId, {
        status: "failed",
        error: errorMessage(cause),
      });
    }
  }
  async function start() {
    if (!valid || running) return;
    setRunning(true);
    setError(null);
    try {
      const batch = await createImportBatch(
        seriesId,
        items.map((item) => ({
          clientId: item.clientId,
          chapterNumber: item.chapterNumber as number,
          filename: item.file.name,
          contentType: canonicalZipMime(item.file),
          sizeBytes: item.file.size,
        })),
      );
      setBatchId(batch.batchId);
      for (const item of batch.items) {
        const mutation: Partial<ImportCandidate> = {
          itemId: item.itemId,
          status: item.status,
        };
        if (item.chapterId) mutation.chapterId = item.chapterId;
        if ("uploadId" in item) mutation.uploadId = item.uploadId;
        if ("errorCode" in item) mutation.error = item.errorCode;
        update(item.clientId, mutation);
      }
      await runPool(
        batch.items
          .filter(
            (item): item is Extract<typeof item, { status: "uploading" }> =>
              item.status === "uploading",
          )
          .map((item) => async () => {
            const candidate = items.find(
              (source) => source.clientId === item.clientId,
            );
            if (candidate && "transfer" in item)
              await transfer(candidate, item);
          }),
        safeBulkUploadConcurrency(
          (() => {
            const value = settings.data?.sections
              .flatMap((section) => section.fields)
              .find((field) => field.key === "bulk_upload_concurrency")?.value;
            return typeof value === "number" ? value : undefined;
          })(),
        ),
      );
      await queryClient.invalidateQueries({
        queryKey: queryKeys.series.chapters(seriesId),
      });
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo iniciar la carga."));
    } finally {
      setRunning(false);
    }
  }
  async function retry(candidate: ImportCandidate) {
    if (
      !batchId ||
      !candidate.itemId ||
      !candidate.chapterId ||
      candidate.status !== "failed"
    )
      return;
    try {
      const session = await retryImportItem(
        seriesId,
        batchId,
        candidate.itemId,
        {
          contentType: canonicalZipMime(candidate.file),
          sizeBytes: candidate.file.size,
        },
      );
      await transfer(candidate, session);
    } catch (cause) {
      update(candidate.clientId, {
        status: "failed",
        error: errorMessage(cause),
      });
    }
  }
  const busy = running || items.some((item) => item.status === "uploading");
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Subir capítulos"
      description={`Selecciona uno o varios ZIP para ${seriesTitle}. Cada archivo se carga directamente a B2.`}
      size="lg"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!valid || busy}
            onClick={() => void start()}
          >
            <Upload aria-hidden="true" className="size-4" />
            {running ? "Subiendo…" : "Subir"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <input
          ref={inputRef}
          className="sr-only"
          type="file"
          multiple
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={(event) => select(event.target.files)}
        />
        <button
          type="button"
          className="grid min-h-36 place-items-center rounded-panel border border-dashed border-border bg-surface p-5 text-center text-secondary hover:bg-surface-hover"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <span className="grid gap-2">
            <Upload aria-hidden="true" className="mx-auto size-5" />
            <span className="font-medium text-text">
              Seleccionar archivos ZIP
            </span>
            <span className="text-sm">
              Uno o varios archivos · ZIP compatible
            </span>
          </span>
        </button>
        {items.length ? (
          <div className="hidden grid-cols-[minmax(0,1fr)_130px_130px_auto] gap-2 px-3 text-xs font-medium uppercase tracking-wide text-muted md:grid">
            <span>Archivo ZIP</span>
            <span>N.º de capítulo</span>
            <span>Estado</span>
            <span aria-hidden="true" />
          </div>
        ) : null}
        {items.map((item) => (
          <div
            key={item.clientId}
            className="grid gap-2 rounded-control border border-border bg-surface p-3 md:grid-cols-[minmax(0,1fr)_130px_130px_auto] md:items-center"
          >
            <span className="flex min-w-0 items-center gap-2 truncate">
              <FileArchive aria-hidden="true" className="size-4 shrink-0" />
              {item.file.name}
            </span>
            <input
              aria-label={`Número de capítulo para ${item.file.name}`}
              placeholder="N.º capítulo"
              type="number"
              min={0}
              step={0.001}
              value={item.chapterNumber ?? ""}
              disabled={busy || item.status !== "pending"}
              onChange={(event) =>
                update(item.clientId, {
                  chapterNumber: event.target.value
                    ? parseChapterNumber(event.target.value)
                    : null,
                })
              }
            />
            <div className="grid gap-1">
              <StatusBadge
                label={labelFor(item.status)}
                tone={toneFor(item.status)}
              />
              {item.status === "uploading" ? (
                <ProgressBar value={item.progress} />
              ) : null}
            </div>
            {item.status === "failed" ? (
              <Button
                type="button"
                disabled={busy}
                onClick={() => void retry(item)}
              >
                Reintentar
              </Button>
            ) : (
              <Button
                aria-label={`Quitar ${item.file.name}`}
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setItems((current) =>
                    current.filter(
                      (candidate) => candidate.clientId !== item.clientId,
                    ),
                  );
                  setBatchId(null);
                }}
              >
                <X aria-hidden="true" className="size-4" />
                Quitar
              </Button>
            )}
            {item.error ? (
              <p className="m-0 text-sm text-danger md:col-span-4">
                {item.error}
              </p>
            ) : null}
            {item.warnings?.map((warning) => (
              <p
                key={`${warning.code}-${warning.filename}`}
                className="m-0 text-sm text-warning md:col-span-4"
              >
                {mediaWarningLabel(warning)}
              </p>
            ))}
          </div>
        ))}
        {items.length > 1 &&
        new Set(
          items
            .map((item) => item.chapterNumber)
            .filter((value) => value !== null),
        ).size !==
          items.filter((item) => item.chapterNumber !== null).length ? (
          <p className="m-0 text-sm text-danger">
            Cada ZIP debe tener un número de capítulo único.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </AppDialog>
  );
}

function isZipFile(file: File) {
  return (
    /\.zip$/i.test(file.name) &&
    (!file.type ||
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed")
  );
}
function canonicalZipMime(file: File) {
  return file.type === "application/x-zip-compressed"
    ? "application/zip"
    : "application/zip";
}
function inferChapterNumber(filename: string): number | null {
  const match = /^(\d+(?:\.\d{1,3})?)\.zip$/i.exec(filename.trim());
  const value = match?.[1];
  return value ? parseChapterNumber(value) : null;
}
function labelFor(status: ImportCandidate["status"]) {
  return {
    pending: "Pendiente",
    uploading: "Subiendo",
    uploaded: "Subido",
    processing: "Procesando",
    ready: "Listo",
    failed: "Error",
  }[status];
}
function toneFor(status: ImportCandidate["status"]) {
  return status === "ready"
    ? "success"
    : status === "failed"
      ? "danger"
      : status === "processing" ||
          status === "uploaded" ||
          status === "uploading"
        ? "info"
        : "neutral";
}
