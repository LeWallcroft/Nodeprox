"use client";

import { ImagePlus, LoaderCircle } from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { hasCapability } from "../../../lib/auth/visibility";
import { ApiError } from "../../../lib/api/types";
import {
  ImageReplacementFileValidationError,
  validateImageReplacementFile,
} from "../../../lib/domains/images/api";
import { useReplaceChapterImage } from "../../../lib/domains/images/hooks";
import type { ImageReplacementPhase } from "../../../lib/domains/images/types";
import { Button } from "../../ui/button";

const acceptedImageContentTypes = "image/jpeg,image/png,image/webp,image/gif";

type SelectedImage = {
  id: string;
  filename: string;
};

type ReplaceImageMutation = (input: {
  chapterId: string;
  imageId: string;
  file: File;
}) => Promise<unknown>;

export function replacementActionLabel(phase: ImageReplacementPhase) {
  switch (phase) {
    case "preparing":
      return "Preparando…";
    case "uploading":
      return "Subiendo…";
    case "completing":
      return "Aplicando…";
    default:
      return "Cambiar imagen";
  }
}

export function imageReplacementErrorMessage(
  error: unknown,
  failurePhase: "preparing" | "uploading" | "completing" | null,
) {
  if (error instanceof ApiError) {
    if (error.code === "image-replacement-conflict")
      return "Ya hay un cambio de imagen o de capítulo en curso. Espera a que finalice antes de intentar nuevamente.";
    if (error.code === "invalid-proxy-path")
      return "La aplicación no pudo conectar el reemplazo. Actualiza la página e inténtalo nuevamente.";
    if (error.code === "authorization-denied")
      return "No tienes permisos para cambiar esta imagen.";
    if (error.code === "upload-provider-unavailable")
      return "El almacenamiento no está disponible temporalmente. Inténtalo nuevamente.";
  }
  if (error instanceof ImageReplacementFileValidationError)
    return "Selecciona una imagen JPG, PNG, WEBP o GIF válida.";
  if (failurePhase === "uploading")
    return "No se pudo subir la imagen. Inténtalo nuevamente.";
  if (failurePhase === "completing")
    return "No se pudo aplicar el reemplazo de la imagen.";
  return "No se pudo preparar el reemplazo de la imagen.";
}

export async function submitSelectedImageReplacement(input: {
  chapterId: string;
  image: SelectedImage;
  file: File;
  mutateAsync: ReplaceImageMutation;
}) {
  const file = validateImageReplacementFile(input.file);
  await input.mutateAsync({
    chapterId: input.chapterId,
    imageId: input.image.id,
    file,
  });
}

export function resetReplacementFileInput(input: HTMLInputElement) {
  input.value = "";
}

export function SelectedImageReplacementAction({
  chapterId,
  image,
  capabilities,
  compact = false,
}: {
  chapterId: string;
  image: SelectedImage | null;
  capabilities: readonly string[] | undefined;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const replacement = useReplaceChapterImage();
  const canReplace =
    Boolean(image) && hasCapability(capabilities, "images.replace");
  const isBusy = replacement.isPending;

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    setValidationError(null);

    try {
      if (!image || !file) return;
      await submitSelectedImageReplacement({
        chapterId,
        image,
        file,
        mutateAsync: replacement.mutateAsync,
      });
    } catch (error) {
      if (error instanceof ImageReplacementFileValidationError)
        setValidationError(imageReplacementErrorMessage(error, null));
    } finally {
      resetReplacementFileInput(input);
    }
  }

  return (
    <div className={compact ? "grid gap-2" : "mt-4 grid gap-2"}>
      <input
        accept={acceptedImageContentTypes}
        aria-label="Seleccionar imagen de reemplazo"
        className="sr-only"
        disabled={!canReplace || isBusy}
        onChange={handleFileChange}
        ref={inputRef}
        type="file"
      />
      <Button
        aria-busy={isBusy || undefined}
        aria-label={`Cambiar imagen${image ? `: ${image.filename}` : ""}`}
        disabled={!canReplace || isBusy}
        type="button"
        variant={compact ? "primary" : "secondary"}
        onClick={() => inputRef.current?.click()}
      >
        {isBusy ? (
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <ImagePlus aria-hidden="true" className="size-4" />
        )}
        {replacementActionLabel(replacement.phase)}
      </Button>
      {!compact ? (
        <p className="m-0 text-xs text-muted">
          Formatos: JPG/JPEG, PNG, WEBP o GIF. No se permiten archivos ZIP.
        </p>
      ) : null}
      {validationError ? (
        <p className="text-[13px] text-danger" role="alert">
          {validationError}
        </p>
      ) : null}
      {replacement.isError ? (
        <p className="text-[13px] text-danger" role="alert">
          {imageReplacementErrorMessage(
            replacement.error,
            replacement.failurePhase,
          )}
        </p>
      ) : null}
      {replacement.isSuccess ? (
        <p
          aria-live="polite"
          className="text-[13px] text-success"
          role="status"
        >
          Cambio enviado al Centro de cargas
        </p>
      ) : null}
    </div>
  );
}
