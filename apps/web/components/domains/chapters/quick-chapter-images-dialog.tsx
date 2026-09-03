"use client";

import Link from "next/link";
import { usePublicChapter } from "../../../lib/domains/publication/hooks";
import {
  publicImageUrlsText,
  sortPublicImages,
} from "../../../lib/domains/publication/utils";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { CopyButton } from "../../ui/copy-button";
import { ErrorState } from "../../ui/error-state";
import { LoadingState } from "../../ui/loading-state";

export function QuickChapterImagesDialog({
  open,
  onClose,
  seriesId,
  seriesTitle,
  chapterId,
  chapterNumber,
}: {
  open: boolean;
  onClose: () => void;
  seriesId: string;
  seriesTitle: string;
  chapterId: string;
  chapterNumber: number;
}) {
  const query = usePublicChapter(chapterId, open);
  const images = sortPublicImages(query.data?.images ?? []);
  return (
    <AppDialog
      description={seriesTitle}
      open={open}
      size="lg"
      title={`Imágenes del capítulo ${chapterNumber}`}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            className="border-border bg-surface text-text hover:bg-surface-hover"
            type="button"
            onClick={onClose}
          >
            Cerrar
          </Button>
          <CopyButton
            value={images.length ? publicImageUrlsText(images) : null}
            label="Copiar todas las URLs"
            failureMessage="No se pudieron copiar las URLs."
          />
          <Link
            className="inline-flex min-h-control items-center justify-center rounded-control bg-primary px-3.5 font-medium text-primary-foreground"
            href={`/series/${seriesId}/chapters/${chapterId}/images`}
            onClick={onClose}
          >
            Gestionar imágenes
          </Link>
        </div>
      }
    >
      {query.isPending ? <LoadingState label="Cargando imágenes" /> : null}
      {query.isError ? (
        <ErrorState
          title="No se pudieron cargar las imágenes"
          description="La proyección pública no está disponible."
        />
      ) : null}
      {query.isSuccess && !images.length ? (
        <p className="m-0 text-sm text-muted">No hay imágenes publicadas.</p>
      ) : null}
      {images.length ? (
        <ol className="grid gap-2">
          {images.map((image) => (
            <li
              className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-control border border-border p-2"
              key={image.id}
            >
              {/* biome-ignore lint/performance/noImgElement: URL comes from the public projection. */}
              <img
                alt={image.filename}
                className="h-12 w-12 rounded-control object-contain"
                src={image.url}
              />
              <div className="min-w-0">
                <p className="m-0 truncate text-sm">{image.filename}</p>
                <p className="m-0 truncate text-xs text-muted">
                  {image.contentType} · {image.url}
                </p>
              </div>
              <CopyButton
                className="border-border bg-surface text-text hover:bg-surface-hover"
                value={image.url}
              />
            </li>
          ))}
        </ol>
      ) : null}
    </AppDialog>
  );
}
