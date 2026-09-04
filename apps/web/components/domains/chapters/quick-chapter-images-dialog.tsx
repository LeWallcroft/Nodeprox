"use client";

import { Images } from "lucide-react";
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
      description={`Capítulo ${chapterNumber} · ${seriesTitle}`}
      open={open}
      size="lg"
      title="Imágenes del capítulo"
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-muted">
            {images.length} de {images.length} imágenes
          </span>
          <Button
            className="border-border bg-surface text-text hover:bg-surface-hover"
            type="button"
            onClick={onClose}
          >
            Cerrar
          </Button>
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
      <div className="mb-3 flex flex-nowrap items-center justify-end gap-2">
        <Link
          aria-label="Gestionar capítulo"
          className="inline-flex min-h-control shrink-0 items-center justify-center gap-2 rounded-control border border-primary bg-primary-soft px-3.5 font-medium text-primary transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          href={`/series/${seriesId}/chapters/${chapterId}/images`}
          onClick={onClose}
        >
          <Images aria-hidden="true" className="size-4" /> Gestionar
        </Link>
        <CopyButton
          className="shrink-0"
          value={images.length ? publicImageUrlsText(images) : null}
          label="Copiar todos los links"
          successLabel="Todos los links copiados"
          failureMessage="No se pudieron copiar los links."
        />
      </div>
      {images.length ? (
        <div className="max-h-[55vh] overflow-auto rounded-control border border-border">
          <table className="w-full min-w-[620px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
                <th className="p-3">Imagen</th>
                <th className="p-3">Orden</th>
                <th className="p-3">URL</th>
                <th className="p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {images.map((image) => (
                <tr
                  className="h-20 border-b border-border last:border-0 [&>td]:align-middle"
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
                  <td
                    className="max-w-56 truncate p-3 text-muted"
                    title={image.url}
                  >
                    {image.url}
                  </td>
                  <td className="p-3">
                    <CopyButton
                      className="border-border bg-surface-elevated text-text hover:bg-surface-hover"
                      value={image.url}
                      label="Copiar URL"
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
