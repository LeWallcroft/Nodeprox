"use client";

import { FileArchive, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";
import {
  nextDragDepth,
  normalizeSelectedZipFiles,
  ZIP_INPUT_ACCEPT,
  type ZipSelectionMode,
} from "../../../lib/domains/uploads/utils";

export type ZipDropzoneProps = {
  mode: ZipSelectionMode;
  disabled?: boolean;
  maxFiles?: number;
  maxItemSizeBytes?: number;
  maxTotalSizeBytes?: number;
  selectedFiles?: readonly File[];
  onFilesSelected: (files: File[]) => void;
  onSelectionRejected?: (message: string) => void;
};

/** Input adapter only: it does not own upload orchestration or lifecycle. */
export function ZipDropzone({
  mode,
  disabled = false,
  maxFiles,
  maxItemSizeBytes,
  maxTotalSizeBytes,
  selectedFiles = [],
  onFilesSelected,
  onSelectionRejected,
}: ZipDropzoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const instructionsId = useId();
  const [dragDepth, setDragDepth] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const dragActive = dragDepth > 0;

  function select(files: Iterable<File> | ArrayLike<File>) {
    if (disabled) return;
    const selection = normalizeSelectedZipFiles(Array.from(files), {
      mode,
      ...(maxFiles !== undefined ? { maxFiles } : {}),
      ...(maxItemSizeBytes !== undefined ? { maxItemSizeBytes } : {}),
      ...(maxTotalSizeBytes !== undefined ? { maxTotalSizeBytes } : {}),
    });
    if (!selection.files.length) {
      if (!selection.message) return;
      setMessage(selection.message);
      onSelectionRejected?.(selection.message);
      return;
    }
    setMessage(selection.message);
    onFilesSelected(selection.files);
  }

  function resetInput() {
    if (input.current) input.current.value = "";
  }

  const description =
    mode === "single"
      ? "Arrastra un ZIP aquí o haz clic para seleccionarlo"
      : "Arrastra uno o varios ZIP aquí o haz clic para seleccionarlos";
  const selectedLabel =
    selectedFiles.length === 1
      ? selectedFiles[0]?.name
      : `${selectedFiles.length} archivos ZIP seleccionados`;

  return (
    <div className="grid gap-2">
      <input
        ref={input}
        className="sr-only"
        id={inputId}
        type="file"
        multiple={mode === "bulk"}
        disabled={disabled}
        accept={ZIP_INPUT_ACCEPT}
        onChange={(event) => {
          select(event.currentTarget.files ?? []);
          resetInput();
        }}
      />
      <button
        aria-describedby={`${instructionsId}${message ? ` ${errorId}` : ""}`}
        aria-label={description}
        aria-disabled={disabled}
        className={`grid min-h-36 place-items-center rounded-panel border border-dashed p-5 text-center text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${
          dragActive
            ? "border-primary bg-primary-soft text-primary"
            : "border-border bg-surface-elevated text-secondary hover:border-primary hover:bg-surface-hover"
        }`}
        disabled={disabled}
        type="button"
        onClick={() => input.current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled)
            setDragDepth((current) => nextDragDepth(current, "enter"));
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled)
            setDragDepth((current) => nextDragDepth(current, "leave"));
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setDragDepth((current) => nextDragDepth(current, "drop"));
          if (!disabled) select(event.dataTransfer.files);
        }}
      >
        {selectedFiles.length ? (
          <span>
            <FileArchive aria-hidden="true" className="mx-auto mb-2 size-5" />
            <strong className="block font-medium text-text">
              {selectedLabel}
            </strong>
            <span>
              {mode === "single"
                ? "Haz clic para reemplazar"
                : "Haz clic para reemplazar la selección"}
            </span>
          </span>
        ) : (
          <span>
            <Upload aria-hidden="true" className="mx-auto mb-2 size-5" />
            <strong className="block font-medium text-text">
              {description}
            </strong>
          </span>
        )}
      </button>
      <p id={instructionsId} className="sr-only">
        Selecciona archivos ZIP con el selector o arrástralos a esta zona.
      </p>
      {message ? (
        <p id={errorId} role="alert" className="m-0 text-sm text-danger">
          {message}
        </p>
      ) : null}
    </div>
  );
}
