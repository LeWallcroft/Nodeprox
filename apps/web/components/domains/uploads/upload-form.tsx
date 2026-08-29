"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { errorMessage } from "../feedback";
import { Button } from "../../ui/button";
import { ProgressBar } from "../../ui/progress-bar";
import { useUploadChapter } from "../../../lib/domains/uploads/hooks";
import { isZipFile } from "../../../lib/domains/uploads/utils";
import { FileArchive, Upload } from "lucide-react";

export function UploadForm({
  seriesId,
  chapterId,
  onSuccess,
}: {
  seriesId: string;
  chapterId: string;
  onSuccess?: () => void;
}) {
  const mutation = useUploadChapter(seriesId, chapterId);
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setValidation(null);
    setFile(selected);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".zip"))
      setValidation("Selecciona un archivo con extensión .zip.");
    else if (!isZipFile(selected))
      setValidation("El archivo debe tener MIME compatible con ZIP.");
    else if (/[\\/\0]/.test(selected.name))
      setValidation("El nombre del archivo no es válido.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || validation) return;
    await mutation.mutateAsync(file);
    onSuccess?.();
  }

  return (
    <form className="grid gap-3.5" onSubmit={submit}>
      <input
        ref={fileInput}
        className="sr-only"
        id="chapter-upload"
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        onChange={handleFile}
      />
      <button
        className="grid min-h-36 place-items-center rounded-panel border border-dashed border-border bg-surface-elevated p-5 text-center text-sm text-secondary hover:border-primary hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        type="button"
        onClick={() => fileInput.current?.click()}
      >
        {file ? (
          <span>
            <FileArchive aria-hidden="true" className="mx-auto mb-2 size-5" />
            <strong className="block font-medium text-text">{file.name}</strong>
            <span>
              {(file.size / 1024 / 1024).toFixed(2)} MB · Haz clic para
              reemplazar
            </span>
          </span>
        ) : (
          <span>
            <Upload aria-hidden="true" className="mx-auto mb-2 size-5" />
            <strong className="block font-medium text-text">
              Arrastra tu ZIP aquí
            </strong>
            <span>o haz clic para seleccionarlo</span>
          </span>
        )}
      </button>
      {file ? (
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            setFile(null);
            setValidation(null);
            if (fileInput.current) fileInput.current.value = "";
          }}
        >
          Quitar archivo
        </Button>
      ) : null}
      {validation ? (
        <p className="text-[13px] text-danger" role="alert">
          {validation}
        </p>
      ) : null}
      {mutation.isError ? (
        <p className="text-[13px] text-danger" role="alert">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {mutation.isPending ? (
        <div className="grid gap-2" aria-live="polite">
          <ProgressBar
            value={mutation.progress}
            label={`Transferencia en curso: ${mutation.progress}%`}
          />
          <span className="text-sm text-muted">Subiendo archivo…</span>
        </div>
      ) : null}
      {mutation.isSuccess ? (
        <p className="text-[13px] text-success" role="status">
          Upload recibido. El procesamiento continuará en segundo plano.
        </p>
      ) : null}
      <Button
        type="submit"
        disabled={!file || Boolean(validation) || mutation.isPending}
      >
        {mutation.isPending ? "Subiendo…" : "Subir ZIP"}
      </Button>
    </form>
  );
}
