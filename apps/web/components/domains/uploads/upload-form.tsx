"use client";

import { type FormEvent, useState } from "react";
import { useUploadChapter } from "../../../lib/domains/uploads/hooks";
import { Button } from "../../ui/button";
import { ProgressBar } from "../../ui/progress-bar";
import { errorMessage } from "../feedback";
import { ZipDropzone } from "./zip-dropzone";

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    await mutation.mutateAsync(file);
    onSuccess?.();
  }

  return (
    <form className="grid gap-3.5" onSubmit={submit}>
      <ZipDropzone
        mode="single"
        disabled={mutation.isPending}
        selectedFiles={file ? [file] : []}
        onFilesSelected={(files) => {
          setFile(files[0] ?? null);
        }}
        onSelectionRejected={() => {
          setFile(null);
        }}
      />
      {file ? (
        <Button
          variant="secondary"
          type="button"
          onClick={() => {
            setFile(null);
          }}
        >
          Quitar archivo
        </Button>
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
      <Button type="submit" disabled={!file || mutation.isPending}>
        {mutation.isPending ? "Subiendo…" : "Subir ZIP"}
      </Button>
    </form>
  );
}
