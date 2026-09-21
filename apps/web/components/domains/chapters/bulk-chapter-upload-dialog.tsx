import {
  CheckCircle2,
  FileArchive,
  Info,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { parseChapterNumber } from "../../../lib/domains/chapters/chapter-number";
import { useChapterList } from "../../../lib/domains/chapters/hooks";
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
import { errorMessage } from "../feedback";
import { ZipDropzone } from "../uploads/zip-dropzone";

export function BulkChapterUploadDialog({
  open,
  onOpenChange,
  onBack,
  seriesId,
  seriesTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBack?: () => void;
  seriesId: string;
  seriesTitle: string;
}) {
  const queue = useUploadQueue();
  const chapters = useChapterList(open ? seriesId : "");
  const [items, setItems] = useState<ImportCandidate[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conflicts = useMemo(() => {
    const byNumber = new Map(
      (chapters.data ?? []).map((chapter) => [chapter.chapterNumber, chapter]),
    );
    return new Map(
      items.flatMap((item) => {
        if (item.chapterNumber === null) return [];
        const chapter = byNumber.get(item.chapterNumber);
        if (!chapter) return [];
        const conflict = preflightConflictLabel(chapter);
        return conflict ? [[item.clientId, conflict] as const] : [];
      }),
    );
  }, [chapters.data, items]);
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
      new Set(items.map((item) => item.chapterNumber)).size === items.length &&
      conflicts.size === 0,
    [conflicts.size, items],
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
      description={`Sube múltiples capítulos para la serie ${seriesTitle}.`}
      size="lg"
      busy={busy}
      footer={
        <div className="flex justify-end gap-2">
          {onBack ? (
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={onBack}
            >
              Volver
            </Button>
          ) : null}
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
            {running ? "Subiendo…" : "Subir capítulos"}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="grid content-start gap-2">
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
            <p className="m-0 text-xs text-muted">
              Solo archivos .ZIP. Máximo {MAX_BULK_ZIP_FILES} archivos y 512 MiB
              por archivo.
            </p>
          </section>
          <section className="min-h-36 rounded-panel border border-border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="m-0 text-sm font-semibold text-text">
                Archivos listos para subir ({items.length})
              </p>
              {items.length ? (
                <button
                  className="text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                  type="button"
                  disabled={busy}
                  onClick={() => setItems([])}
                >
                  Limpiar todo
                </button>
              ) : null}
            </div>
            {items.length ? (
              <div className="grid divide-y divide-border">
                {items.map((item) => (
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_5rem_auto_auto] items-center gap-2 py-2"
                    key={item.clientId}
                  >
                    <span className="flex min-w-0 items-center gap-2 truncate text-sm text-text">
                      <FileArchive
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted"
                      />
                      {item.file.name}
                    </span>
                    <input
                      aria-label={`Número de capítulo para ${item.file.name}`}
                      className="h-8 min-w-0 px-2 text-sm"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="N.º"
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
                    {item.status === "failed" ? (
                      <X
                        aria-label="Error de carga"
                        className="size-4 text-danger"
                      />
                    ) : (
                      <CheckCircle2
                        aria-label={labelFor(item.status)}
                        className="size-4 text-success"
                      />
                    )}
                    <button
                      aria-label={`Quitar ${item.file.name}`}
                      className="inline-flex size-8 items-center justify-center rounded-control text-danger hover:bg-destructive-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-danger"
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
                      <Trash2 aria-hidden="true" className="size-4" />
                    </button>
                    {item.status === "uploading" ? (
                      <ProgressBar value={item.progress} />
                    ) : null}
                    {item.error ? (
                      <p className="col-span-4 m-0 text-sm text-danger">
                        {importErrorLabel(item.error)}
                      </p>
                    ) : null}
                    {conflicts.get(item.clientId) ? (
                      <p className="col-span-4 m-0 text-sm text-danger">
                        {conflicts.get(item.clientId)}
                      </p>
                    ) : null}
                    {item.warnings?.map((warning) => (
                      <p
                        key={`${warning.code}-${warning.filename}`}
                        className="col-span-4 m-0 text-sm text-warning"
                      >
                        {mediaWarningLabel(warning)}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <p className="m-0 grid min-h-24 place-items-center text-center text-sm text-muted">
                Añade los ZIP para asignar el número de cada capítulo.
              </p>
            )}
          </section>
        </div>
        <div className="flex items-start gap-2 rounded-control border border-[var(--border-subtle)] bg-primary-soft px-3 py-2 text-sm text-secondary">
          <Info
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-primary"
          />
          Las cargas se realizarán en segundo plano. Recibirás una notificación
          cuando finalicen.
        </div>
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
        {chapters.isFetching && items.length ? (
          <p className="m-0 text-sm text-secondary">
            Validando los capítulos existentes…
          </p>
        ) : null}
        {chapters.isError ? (
          <p className="m-0 text-sm text-warning">
            No se pudo comprobar el estado actual de los capítulos. El servidor
            volverá a validarlo antes de iniciar cada carga.
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

function preflightConflictLabel(chapter: {
  status: string;
  imageCount: number;
}): string | null {
  if (chapter.imageCount > 0)
    return "Este capítulo ya contiene imágenes. Usa Cambiar capítulo para reemplazarlas.";
  if (chapter.status === "ready")
    return "Este capítulo ya fue completado. Usa Cambiar capítulo para reemplazarlo.";
  if (chapter.status === "uploading")
    return "Este capítulo ya tiene una carga activa.";
  if (chapter.status === "uploaded" || chapter.status === "processing")
    return "Este capítulo se está procesando.";
  if (chapter.status === "failed")
    return "Este capítulo tiene una carga fallida. Reintenta o gestiona ese capítulo existente.";
  if (chapter.status === "deleting") return "Este capítulo se está eliminando.";
  return null;
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
