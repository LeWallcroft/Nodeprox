"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { parseChapterNumber } from "../../../lib/domains/chapters/chapter-number";
import { useCreateChapter } from "../../../lib/domains/chapters/hooks";
import { useSeriesList } from "../../../lib/domains/series/hooks";
import { useUploadChapter } from "../../../lib/domains/uploads/hooks";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { ProgressBar } from "../../ui/progress-bar";
import { SearchableCombobox } from "../../ui/searchable-combobox";
import { errorMessage } from "../feedback";
import { ZipDropzone } from "../uploads/zip-dropzone";

export function GlobalChapterCreateDialog({
  open,
  onOpenChange,
  onCreated,
  fixedSeries,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (chapterId: string) => void;
  fixedSeries?: { id: string; title: string; slug?: string | null };
}) {
  const series = useSeriesList();
  const [seriesId, setSeriesId] = useState("");
  const [number, setNumber] = useState("");
  const [title, setTitle] = useState("");
  const [zip, setZip] = useState<File | null>(null);
  const [created, setCreated] = useState<{
    id: string;
    seriesId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uploadStarted = useRef(false);
  const activeSeriesId = fixedSeries?.id ?? seriesId;
  const create = useCreateChapter(activeSeriesId);
  const selectedSeries =
    fixedSeries ?? (series.data ?? []).find((item) => item.id === seriesId);
  const upload = useUploadChapter(created?.seriesId ?? "", created?.id ?? "");
  const busy = create.isPending || upload.isPending;

  const close = useCallback(() => {
    setSeriesId("");
    setNumber("");
    setTitle("");
    setZip(null);
    setCreated(null);
    setError(null);
    uploadStarted.current = false;
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!created || !zip || uploadStarted.current) return;
    uploadStarted.current = true;
    void upload
      .mutateAsync(zip)
      .then(close)
      .catch((cause) => {
        setError(errorMessage(cause, "No se pudo subir el ZIP del capítulo."));
        uploadStarted.current = false;
      });
  }, [close, created, upload, zip]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chapterNumber = parseChapterNumber(number);
    if (!selectedSeries || chapterNumber === null) {
      setError("Selecciona una serie y usa un número de capítulo válido.");
      return;
    }
    setError(null);
    try {
      const chapter = await create.mutateAsync({
        chapterNumber,
        title: title.trim() || null,
      });
      onCreated(chapter.id);
      if (!zip) {
        close();
        return;
      }
      setCreated({ id: chapter.id, seriesId: selectedSeries.id });
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => next || close()}
      title="Nuevo capítulo"
      description="Crea un capítulo individual y, si corresponde, adjunta un único ZIP al final del formulario."
      busy={busy}
    >
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        {fixedSeries ? (
          <div className="grid gap-1.5 text-[13px] font-medium text-muted">
            Serie
            <div className="rounded-control border border-[var(--border-subtle)] bg-surface px-3 py-2 text-sm text-text">
              {fixedSeries.title}
              {fixedSeries.slug ? (
                <span className="ml-2 text-xs text-muted">
                  ({fixedSeries.slug})
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <SearchableCombobox
            id="global-chapter-series"
            label="Serie"
            required
            value={seriesId}
            options={(series.data ?? []).map((item) => ({
              id: item.id,
              label: item.title,
              description: item.slug,
              imageUrl: item.coverUrl,
            }))}
            loading={series.isPending}
            error={
              series.isError ? "No se pudieron cargar las series." : undefined
            }
            onRetry={() => void series.refetch()}
            placeholder="Selecciona una serie"
            emptyMessage="No hay series disponibles."
            onChange={setSeriesId}
          />
        )}
        <label
          className="grid gap-1.5 text-[13px] font-medium text-muted"
          htmlFor="global-chapter-number"
        >
          Número de capítulo
          <input
            id="global-chapter-number"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            pattern="[0-9]+([.,][0-9]{1,3})?"
            required
            disabled={!selectedSeries || busy}
            value={number}
            onChange={(event) => setNumber(event.target.value)}
          />
          <span className="text-xs font-normal">
            Se valida que el número no exista dentro de la Serie seleccionada.
          </span>
        </label>
        <label
          className="grid gap-1.5 text-[13px] font-medium text-muted"
          htmlFor="global-chapter-title"
        >
          Título (opcional)
          <input
            id="global-chapter-title"
            maxLength={200}
            disabled={!selectedSeries || busy}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ej. Capítulo 26"
          />
        </label>
        <div className="grid gap-2 border-t border-border pt-4">
          <div>
            <p className="m-0 text-[13px] font-medium text-muted">
              Subir ZIP (opcional)
            </p>
            <p className="mb-0 mt-1 text-xs text-muted">
              El ZIP se inicia después de crear el capítulo. Puedes crear sólo
              el capítulo para asignar colaboradores después.
            </p>
          </div>
          <ZipDropzone
            mode="single"
            disabled={!selectedSeries || busy}
            selectedFiles={zip ? [zip] : []}
            onFilesSelected={(files) => setZip(files[0] ?? null)}
            onSelectionRejected={(message) => setError(message)}
          />
          {zip ? (
            <Button
              variant="secondary"
              type="button"
              disabled={busy}
              onClick={() => setZip(null)}
            >
              Quitar ZIP
            </Button>
          ) : null}
        </div>
        {upload.isPending ? (
          <div className="grid gap-2" aria-live="polite">
            <ProgressBar
              value={upload.progress}
              label={`Transferencia en curso: ${upload.progress}%`}
            />
            <span className="text-sm text-muted">Subiendo ZIP…</span>
          </div>
        ) : null}
        {error ? (
          <p className="m-0 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={close}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!selectedSeries || busy}>
            {busy ? "Guardando…" : zip ? "Crear y subir ZIP" : "Crear capítulo"}
          </Button>
        </div>
      </form>
    </AppDialog>
  );
}
