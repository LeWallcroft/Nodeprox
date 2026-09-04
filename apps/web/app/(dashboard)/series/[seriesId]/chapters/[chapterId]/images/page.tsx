"use client";

import {
  ExternalLink,
  Eye,
  Image,
  Images,
  Info,
  RefreshCw,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SelectedImageReplacementAction } from "../../../../../../../components/domains/chapters/selected-image-replacement-action";
import { WholeChapterReplacementDialog } from "../../../../../../../components/domains/chapters/whole-chapter-replacement-dialog";
import { PageHeader } from "../../../../../../../components/layout/page-header";
import { CopyButton } from "../../../../../../../components/ui/copy-button";
import { EmptyState } from "../../../../../../../components/ui/empty-state";
import { ErrorState } from "../../../../../../../components/ui/error-state";
import { LoadingState } from "../../../../../../../components/ui/loading-state";
import { hasCapability } from "../../../../../../../lib/auth/visibility";
import {
  useChapter,
  useChapterCapabilities,
} from "../../../../../../../lib/domains/chapters/hooks";
import { usePublicChapter } from "../../../../../../../lib/domains/publication/hooks";
import {
  publicImageUrlsText,
  sortPublicImages,
} from "../../../../../../../lib/domains/publication/utils";
import { useSeries } from "../../../../../../../lib/domains/series/hooks";

export default function ChapterImagesPage() {
  const { seriesId, chapterId } = useParams<{
    seriesId: string;
    chapterId: string;
  }>();
  const chapter = useChapter(chapterId);
  const series = useSeries(seriesId);
  const capabilities = useChapterCapabilities(chapterId);
  const publication = usePublicChapter(
    chapterId,
    chapter.data?.status === "ready",
  );
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [replacingChapter, setReplacingChapter] = useState(false);
  const images = useMemo(
    () => sortPublicImages(publication.data?.images ?? []),
    [publication.data],
  );
  const selectedImages = images.filter((image) =>
    selectedImageIds.has(image.id),
  );
  const pageSize = 10;
  const pageImages = images.slice(page * pageSize, page * pageSize + pageSize);
  const selectedImage =
    images.find((image) => image.id === selectedImageId) ?? null;
  const canReplaceChapter = hasCapability(
    capabilities.data?.capabilities,
    "chapters.replace",
  );

  useEffect(() => {
    if (!publication.isSuccess) return;
    const canonicalIds = new Set(images.map((image) => image.id));
    setSelectedImageId((current) =>
      current && canonicalIds.has(current) ? current : null,
    );
    setSelectedImageIds((current) => {
      const retained = new Set(
        [...current].filter((imageId) => canonicalIds.has(imageId)),
      );
      return retained.size === current.size ? current : retained;
    });
  }, [images, publication.isSuccess]);
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
            {canReplaceChapter && chapter.data ? (
              <button
                className="inline-flex min-h-control items-center justify-center gap-2 rounded-control border border-border bg-surface px-3.5 font-medium text-text hover:bg-surface-hover"
                type="button"
                onClick={() => setReplacingChapter(true)}
              >
                <RefreshCw aria-hidden="true" className="size-4" /> Cambiar
                capítulo entero
              </button>
            ) : null}
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
        <section className="grid min-h-0 gap-card xl:h-[calc(100vh-12rem)] xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-stretch">
          <div className="flex min-h-0 flex-col overflow-x-auto rounded-panel border border-border bg-surface">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.08em] text-muted">
                  <th className="p-3">
                    <input
                      aria-label="Seleccionar todas"
                      type="checkbox"
                      checked={selectedImageIds.size === images.length}
                      onChange={(event) =>
                        setSelectedImageIds(
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
                    onClick={() =>
                      setSelectedImageId((current) =>
                        current === image.id ? null : image.id,
                      )
                    }
                  >
                    <td className="p-3">
                      <input
                        aria-label={`Seleccionar ${image.filename}`}
                        type="checkbox"
                        checked={selectedImageIds.has(image.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          setSelectedImageIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) {
                              next.add(image.id);
                              setSelectedImageId(image.id);
                            } else {
                              next.delete(image.id);
                              setSelectedImageId((focused) =>
                                focused === image.id ? null : focused,
                              );
                            }
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
            <div className="mt-auto flex items-center justify-between border-t border-border p-3 text-sm text-muted">
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
          <aside className="flex min-h-0 flex-col rounded-panel border border-border bg-surface p-4 text-sm text-muted xl:h-full">
            {selectedImage ? (
              <section className="mb-4 shrink-0">
                <h2 className="m-0 flex items-center gap-2 text-sm font-semibold text-text xl:col-span-3">
                  <Image aria-hidden="true" className="size-4 text-primary" />
                  Imagen seleccionada
                </h2>
                <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[5rem_minmax(0,1fr)_auto]">
                  {/* biome-ignore lint/performance/noImgElement: canonical public URLs preserve the detail image aspect ratio. */}
                  <img
                    alt={selectedImage.filename}
                    className="h-20 w-20 shrink-0 rounded-control bg-surface-elevated object-contain"
                    src={selectedImage.url}
                  />
                  <div className="min-w-0">
                    <p className="m-0 truncate font-semibold text-text">
                      {selectedImage.filename}
                    </p>
                    <p className="mb-1 mt-2">
                      Orden: {selectedImage.sortOrder}
                    </p>
                    <p className="mb-1">Formato: {selectedImage.contentType}</p>
                    <p className="m-0">URL activa: Activa</p>
                  </div>
                  <div className="flex w-max flex-col items-stretch gap-2">
                    <SelectedImageReplacementAction
                      capabilities={capabilities.data?.capabilities}
                      chapterId={chapterId}
                      image={selectedImage}
                      compact
                    />
                    <a
                      className="inline-flex min-h-control items-center justify-center gap-2 rounded-control border border-border bg-surface px-3.5 font-medium text-text hover:bg-surface-hover"
                      href={selectedImage.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Eye aria-hidden="true" className="size-4" /> Abrir URL
                      pública
                    </a>
                  </div>
                </div>
                <div className="mt-3 flex gap-2 rounded-control border border-primary bg-primary-soft p-2.5 text-xs text-text xl:col-span-3">
                  <Info
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-primary"
                  />
                  <div>
                    <p className="m-0">
                      Al reemplazar esta imagen se creará una nueva versión y se
                      actualizará automáticamente su URL pública.
                    </p>
                    <p className="mb-0 mt-1 text-muted">
                      Formatos: JPG/JPEG, PNG, WEBP o GIF. No se permiten
                      archivos ZIP.
                    </p>
                  </div>
                </div>
              </section>
            ) : null}
            <section className="flex min-h-0 flex-1 flex-col">
              <div className="mb-3 flex flex-nowrap items-center justify-between gap-3">
                <h2 className="m-0 flex items-center gap-2 text-sm font-semibold text-text">
                  <Images aria-hidden="true" className="size-4 text-primary" />{" "}
                  Vista previa del capítulo
                </h2>
                <span className="shrink-0 text-xs font-medium text-primary">
                  Ajustar ancho ▾
                </span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-control border border-border">
                {images.map((image) => (
                  <button
                    className={`block w-full border-b border-border p-1 last:border-0 ${selectedImageId === image.id ? "ring-2 ring-inset ring-primary" : ""}`}
                    key={image.id}
                    type="button"
                    onClick={() =>
                      setSelectedImageId((current) =>
                        current === image.id ? null : image.id,
                      )
                    }
                  >
                    {/* biome-ignore lint/performance/noImgElement: canonical public URLs preserve the webtoon image aspect ratio. */}
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
      {chapter.data ? (
        <WholeChapterReplacementDialog
          chapterId={chapterId}
          chapterNumber={chapter.data.chapterNumber}
          open={replacingChapter}
          seriesId={seriesId}
          seriesTitle={series.data?.title ?? "Serie"}
          onOpenChange={setReplacingChapter}
        />
      ) : null}
    </>
  );
}
