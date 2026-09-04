"use client";

import Link from "next/link";
import { usePublicChapter } from "../../../lib/domains/publication/hooks";
import {
  publicImageUrlsText,
  sortPublicImages,
} from "../../../lib/domains/publication/utils";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { ContentImage } from "../../ui/content-image";
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
            Gestionar capítulo
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
        <div className="overflow-x-auto rounded-control border border-border">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
                <th className="p-3">Imagen</th>
                <th className="p-3">Número</th>
                <th className="p-3">Estado</th>
                <th className="p-3">URL</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {images.map((image) => (
                <tr
                  className="border-b border-border last:border-0"
                  key={image.id}
                >
                  <td className="p-3">
                    <ContentImage
                      alt={image.filename}
                      src={image.url}
                      variant="thumbnail"
                    />
                  </td>
                  <td className="p-3">{image.sortOrder}</td>
                  <td className="p-3 text-muted">Listo</td>
                  <td
                    className="max-w-56 truncate p-3 text-muted"
                    title={image.url}
                  >
                    {image.url}
                  </td>
                  <td className="p-3">
                    <CopyButton
                      className="border-border bg-surface text-text hover:bg-surface-hover"
                      value={image.url}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AppDialog>
  );
}
