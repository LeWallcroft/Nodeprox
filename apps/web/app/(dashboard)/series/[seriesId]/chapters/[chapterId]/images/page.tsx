"use client";

import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { PageHeader } from "../../../../../../../components/layout/page-header";
import { CopyButton } from "../../../../../../../components/ui/copy-button";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import { ErrorState } from "../../../../../../../components/ui/error-state";
import { LoadingState } from "../../../../../../../components/ui/loading-state";
import { useChapter } from "../../../../../../../lib/domains/chapters/hooks";
import { usePublicChapter } from "../../../../../../../lib/domains/publication/hooks";
import {
  publicImageUrlsText,
  sortPublicImages,
} from "../../../../../../../lib/domains/publication/utils";

export default function ChapterImagesPage() {
  const { seriesId, chapterId } = useParams<{
    seriesId: string;
    chapterId: string;
  }>();
  const chapter = useChapter(chapterId);
  const publication = usePublicChapter(
    chapterId,
    chapter.data?.status === "ready",
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const images = useMemo(
    () => sortPublicImages(publication.data?.images ?? []),
    [publication.data],
  );
  const selectedImages = images.filter((image) => selected.has(image.id));
  return (
    <>
      <PageHeader
        back={{
          label: "Volver a capítulos",
          href: `/series/${seriesId}/chapters`,
        }}
        breadcrumbs={[
          { label: "Series", href: "/series" },
          { label: "Capítulos", href: `/series/${seriesId}/chapters` },
          { label: "Imágenes", current: true },
        ]}
        title={
          chapter.data
            ? `Imágenes del capítulo ${chapter.data.chapterNumber}`
            : "Imágenes del capítulo"
        }
        description="URLs públicas y orden canónico de imágenes."
        actions={
          <div className="flex flex-wrap gap-2">
            <CopyButton
              className="border-border bg-surface text-text hover:bg-surface-hover"
              value={
                selectedImages.length
                  ? publicImageUrlsText(selectedImages)
                  : null
              }
              label="Copiar seleccionadas"
              failureMessage="No se pudieron copiar las URLs seleccionadas."
            />
            <CopyButton
              value={images.length ? publicImageUrlsText(images) : null}
              label="Copiar todas"
              failureMessage="No se pudieron copiar las URLs."
            />
          </div>
        }
      />
      {publication.isPending ? (
        <LoadingState label="Cargando imágenes" />
      ) : null}
      {publication.isError ? (
        <ErrorState
          title="No se pudieron cargar las imágenes"
          description="La proyección pública no está disponible para este capítulo."
        />
      ) : null}
      {publication.isSuccess && !images.length ? (
        <EmptyState
          title="Sin imágenes publicadas"
          description="Este capítulo aún no tiene imágenes publicadas."
        />
      ) : null}
      {images.length ? (
        <section className="grid gap-card xl:grid-cols-[minmax(0,3fr)_minmax(300px,1fr)]">
          <div className="overflow-x-auto rounded-panel border border-border bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="p-3">
                    <input
                      aria-label="Seleccionar todas"
                      type="checkbox"
                      checked={selected.size === images.length}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? new Set(images.map((image) => image.id))
                            : new Set(),
                        )
                      }
                    />
                  </th>
                  <th className="p-3">Imagen</th>
                  <th className="p-3">Orden</th>
                  <th className="p-3">Tipo</th>
                  <th className="p-3">URL pública</th>
                </tr>
              </thead>
              <tbody>
                {images.map((image) => (
                  <tr
                    className="border-b border-border last:border-0"
                    key={image.id}
                  >
                    <td className="p-3">
                      <input
                        aria-label={`Seleccionar ${image.filename}`}
                        type="checkbox"
                        checked={selected.has(image.id)}
                        onChange={() =>
                          setSelected((current) => {
                            const next = new Set(current);
                            next.has(image.id)
                              ? next.delete(image.id)
                              : next.add(image.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-3">
                        {/* biome-ignore lint/performance/noImgElement: public URL is projected by the backend. */}
                        <img
                          alt={image.filename}
                          className="h-12 w-12 rounded-control border border-border object-contain"
                          src={image.url}
                        />
                        <span>{image.filename}</span>
                      </div>
                    </td>
                    <td className="p-3 text-muted">{image.sortOrder}</td>
                    <td className="p-3 text-muted">{image.contentType}</td>
                    <td
                      className="max-w-56 truncate p-3 text-muted"
                      title={image.url}
                    >
                      {image.url}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="rounded-panel border border-border bg-surface p-5 text-sm text-muted">
            Selecciona imágenes para copiar sus URLs públicas en orden canónico.
          </aside>
        </section>
      ) : null}
    </>
  );
}
