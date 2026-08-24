"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { errorMessage } from "../feedback";
import { Button } from "../../ui/button";
import { ProgressBar } from "../../ui/progress-bar";
import { useUploadChapter } from "../../../lib/domains/uploads/hooks";

export function UploadForm({
  seriesId,
  chapterId,
}: {
  seriesId: string;
  chapterId: string;
}) {
  const mutation = useUploadChapter(seriesId, chapterId);
  const [file, setFile] = useState<File | null>(null);
  const [validation, setValidation] = useState<string | null>(null);

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setValidation(null);
    setFile(selected);
    if (!selected) return;
    if (!selected.name.toLowerCase().endsWith(".zip"))
      setValidation("Selecciona un archivo con extensión .zip.");
    else if (selected.type && selected.type !== "application/zip")
      setValidation("El archivo debe tener MIME application/zip.");
    else if (/[\\/\0]/.test(selected.name))
      setValidation("El nombre del archivo no es válido.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || validation) return;
    await mutation.mutateAsync(file);
  }

  return (
    <form className="grid gap-3.5" onSubmit={submit}>
      <label
        className="grid gap-1.5 text-[13px] font-bold text-muted"
        htmlFor="chapter-upload"
      >
        Archivo ZIP
        <input
          id="chapter-upload"
          type="file"
          accept=".zip,application/zip"
          onChange={handleFile}
        />
      </label>
      {validation ? (
        <p className="text-[13px] text-[#a52f2f]" role="alert">
          {validation}
        </p>
      ) : null}
      {mutation.isError ? (
        <p className="text-[13px] text-[#a52f2f]" role="alert">
          {errorMessage(mutation.error)}
        </p>
      ) : null}
      {mutation.isPending ? (
        <div className="grid gap-2" aria-live="polite">
          <ProgressBar value={0} label="Transferencia en curso" />
          <span className="text-sm text-muted">Subiendo archivo…</span>
        </div>
      ) : null}
      {mutation.isSuccess ? (
        <p className="text-[13px] text-[#187344]" role="status">
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
