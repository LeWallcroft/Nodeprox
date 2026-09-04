"use client";

import { ExternalLink, Eye } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { SelectedImageReplacementAction } from "../../../../../../../components/domains/chapters/selected-image-replacement-action";
import { PageHeader } from "../../../../../../../components/layout/page-header";
import { CopyButton } from "../../../../../../../components/ui/copy-button";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import { ErrorState } from "../../../../../../../components/ui/error-state";
import { LoadingState } from "../../../../../../../components/ui/loading-state";
import {
  useChapter,
  useChapterCapabilities,
} from "../../../../../../../lib/domains/chapters/hooks";
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
  const capabilities = useChapterCapabilities(chapterId);
  const publication = usePublicChapter(
    chapterId,
    chapter.data?.status === "ready",
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const images = useMemo(
    () => sortPublicImages(publication.data?.images ?? []),
    [publication.data],
  );
  const selectedImages = images.filter((image) => selected.has(image.id));
  const pageSize = 10;
  const pageImages = images.slice(page * pageSize, page * pageSize + pageSize);
  const selectedImage =
    images.find((image) => image.id === selectedImageId) ?? null;
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
                  <th className="p-3">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pageImages.map((image) => (
                  <tr
                    className={`border-b border-border last:border-0 ${selectedImageId === image.id ? "bg-primary-soft" : ""}`}
                    key={image.id}
                    onClick={() => setSelectedImageId(image.id)}
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
                    <td className="p-3">
                      <a
                        aria-label={`Abrir URL pública de ${image.filename}`}
                        className="text-primary"
                        href={image.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <ExternalLink aria-hidden="true" className="size-4" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-border p-3 text-sm text-muted">
              <span>
                {page * pageSize + 1}–
                {Math.min((page + 1) * pageSize, images.length)} de{" "}
                {images.length}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page === 0}
                  type="button"
                  onClick={() => setPage((current) => current - 1)}
                >
                  Anterior
                </button>
                <button
                  disabled={(page + 1) * pageSize >= images.length}
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                >
                  Siguiente
                </button>
              </div>
            </div>
          </div>
          <aside className="max-h-[calc(100vh-12rem)] overflow-y-auto rounded-panel border border-border bg-surface p-5 text-sm text-muted xl:sticky xl:top-4">
            {selectedImage ? (
              <section>
                <h2 className="mt-0 text-base text-text">
                  Imagen seleccionada
                </h2>
                <img
                  alt={selectedImage.filename}
                  className="max-h-48 w-full rounded-control bg-surface-elevated object-contain"
                  src={selectedImage.url}
                />
                <p>{selectedImage.filename}</p>
                <p>Orden: {selectedImage.sortOrder}</p>
                <p>{selectedImage.contentType}</p>
                <SelectedImageReplacementAction
                  capabilities={capabilities.data?.capabilities}
                  chapterId={chapterId}
                  image={selectedImage}
                />
                <a
                  className="inline-flex items-center gap-2 text-primary"
                  href={selectedImage.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <Eye aria-hidden="true" className="size-4" /> Abrir URL
                  pública
                </a>
              </section>
            ) : (
              <p>Selecciona una imagen en la tabla o el visor.</p>
            )}
            <section className="mt-6">
              <h2 className="text-base text-text">Vista previa del capítulo</h2>
              <div className="max-h-[55vh] overflow-y-auto rounded-control border border-border">
                {images.map((image) => (
                  <button
                    className="block w-full border-b border-border p-1 last:border-0"
                    key={image.id}
                    type="button"
                    onClick={() => setSelectedImageId(image.id)}
                  >
                    <img
                      alt={image.filename}
                      className="h-auto w-full"
                      src={image.url}
                    />
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </section>
      ) : null}
    </>
  );
}
