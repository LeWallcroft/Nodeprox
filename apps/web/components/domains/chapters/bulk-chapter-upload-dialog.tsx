import { FileArchive, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { parseChapterNumber } from "../../../lib/domains/chapters/chapter-number";
import { mediaWarningLabel } from "../../../lib/domains/ingestion/orchestration";
import type { ImportCandidate } from "../../../lib/domains/ingestion/types";
import {
  DEFAULT_MAX_ZIP_SIZE_BYTES,
  MAX_BULK_ZIP_FILES,
  MAX_BULK_ZIP_TOTAL_SIZE_BYTES,
} from "../../../lib/domains/uploads/utils";
import { useUploadQueue } from "../../providers/upload-queue-provider";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { ProgressBar } from "../../ui/progress-bar";
import { StatusBadge } from "../../ui/status-badge";
import { errorMessage } from "../feedback";
import { ZipDropzone } from "../uploads/zip-dropzone";

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
  const queue = useUploadQueue();
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = useMemo(
    () =>
      items.length > 0 &&
      items.length <= MAX_BULK_ZIP_FILES &&
      items.reduce((total, item) => total + item.file.size, 0) <=
        MAX_BULK_ZIP_TOTAL_SIZE_BYTES &&
      items.every(
        (item) =>
          item.chapterNumber !== null &&
          Number.isFinite(item.chapterNumber) &&
          item.chapterNumber >= 0 &&
          item.file.size > 0 &&
          item.file.size <= DEFAULT_MAX_ZIP_SIZE_BYTES,
      ) &&
      new Set(items.map((item) => item.chapterNumber)).size === items.length,
    [items],
  );

  function update(clientId: string, mutation: Partial<ImportCandidate>) {
    setItems((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...mutation } : item,
      ),
    );
  }
  function select(files: File[]) {
    const selected = files.map((file) => ({
      clientId: crypto.randomUUID(),
      file,
      chapterNumber: inferChapterNumber(file.name),
      status: "pending" as const,
      progress: 0,
    }));
    setItems(selected);
    setError(null);
  }
  async function start() {
    if (!valid || running) return;
    setRunning(true);
    setError(null);
    try {
      await queue.startBatch({ seriesId, seriesTitle, items });
      setItems([]);
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo iniciar la carga."));
    } finally {
      setRunning(false);
    }
  }
  const busy = running;
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
        <ZipDropzone
          mode="bulk"
          disabled={busy}
          selectedFiles={items.map((item) => item.file)}
          maxFiles={MAX_BULK_ZIP_FILES}
          maxItemSizeBytes={DEFAULT_MAX_ZIP_SIZE_BYTES}
          maxTotalSizeBytes={MAX_BULK_ZIP_TOTAL_SIZE_BYTES}
          onFilesSelected={select}
          onSelectionRejected={setError}
        />
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
              {item.resolution ? (
                <span className="text-xs text-secondary">
                  {resolutionLabel(item.resolution)}
                </span>
              ) : null}
              {item.status === "uploading" ? (
                <ProgressBar value={item.progress} />
              ) : null}
            </div>
            <Button
              aria-label={`Quitar ${item.file.name}`}
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() =>
                setItems((current) =>
                  current.filter(
                    (candidate) => candidate.clientId !== item.clientId,
                  ),
                )
              }
            >
              <X aria-hidden="true" className="size-4" />
              Quitar
            </Button>
            {item.error ? (
              <p className="m-0 text-sm text-danger md:col-span-4">
                {importErrorLabel(item.error)}
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
        {items.length > MAX_BULK_ZIP_FILES ? (
          <p className="m-0 text-sm text-danger">
            Un batch admite como máximo 15 archivos ZIP.
          </p>
        ) : null}
        {items.reduce((total, item) => total + item.file.size, 0) >
        MAX_BULK_ZIP_TOTAL_SIZE_BYTES ? (
          <p className="m-0 text-sm text-danger">
            El tamaño total del batch no puede superar 3 GiB.
          </p>
        ) : null}
        {items.some((item) => item.file.size > DEFAULT_MAX_ZIP_SIZE_BYTES) ? (
          <p className="m-0 text-sm text-danger">
            Cada ZIP debe pesar como máximo 512 MiB.
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

export function resolutionLabel(
  resolution: NonNullable<ImportCandidate["resolution"]>,
) {
  return {
    created: "Capítulo creado",
    reused: "Capítulo reutilizado",
    conflict: "Conflicto de capítulo",
  }[resolution];
}

export function importErrorLabel(errorCode: string) {
  return (
    {
      "chapter-upload-active": "El capítulo ya tiene una carga activa.",
      "chapter-uploaded": "El capítulo ya tiene una carga completada.",
      "chapter-processing": "El capítulo se está procesando.",
      "chapter-ready": "El capítulo ya está listo.",
      "chapter-failed": "El capítulo requiere reintentar su carga existente.",
      "chapter-deleting": "El capítulo se está eliminando.",
      "chapter-media-exists": "El capítulo ya contiene imágenes.",
    }[errorCode] ?? errorCode
  );
}
