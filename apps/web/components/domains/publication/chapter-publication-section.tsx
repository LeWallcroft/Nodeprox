"use client";

import { useState } from "react";
import { ApiError } from "../../../lib/api/types";
import { errorMessage } from "../feedback";
import { Button } from "../../ui/button";
import { ErrorState } from "../../ui/error-state";
import { Skeleton } from "../../ui/skeleton";
import { usePublicChapter } from "../../../lib/domains/publication/hooks";
import {
  publicImageUrlsText,
  sortPublicImages,
} from "../../../lib/domains/publication/utils";
import type { PublicImage } from "../../../lib/domains/publication/types";

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  return `${(sizeBytes / 1024).toFixed(1)} KB`;
}

function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  async function copy() {
    setFailed(false);
    try {
      if (!navigator.clipboard) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="grid justify-items-start gap-1">
      <Button type="button" onClick={() => void copy()}>
        {copied ? "Copiado" : "Copiar URL"}
      </Button>
      {failed ? (
        <span className="text-xs text-danger" role="alert">
          No se pudo copiar la URL.
        </span>
      ) : null}
    </div>
  );
}

function ImageListItem({ image }: { image: PublicImage }) {
  return (
    <li className="grid gap-4 rounded-xl border border-border bg-surface p-4 md:grid-cols-[7rem_1fr_auto] md:items-center">
      {/* The public URL must be requested directly, without a Next image proxy. */}
      {/* biome-ignore lint/performance/noImgElement: public media URLs must remain direct */}
      <img
        className="h-28 w-28 rounded-lg border border-border object-contain"
        src={image.url}
        alt={image.filename}
        loading="lazy"
      />
      <div className="min-w-0 space-y-1 text-sm">
        <p className="truncate font-semibold">{image.filename}</p>
        <p className="text-muted">
          {image.extension} · {image.contentType} ·{" "}
          {formatBytes(image.sizeBytes)}
        </p>
        <code className="block break-all text-xs text-muted">{image.url}</code>
      </div>
      <CopyUrlButton url={image.url} />
    </li>
  );
}

export function ChapterPublicationSection({
  chapterId,
  chapterStatus,
}: {
  chapterId: string;
  chapterStatus: string;
}) {
  const query = usePublicChapter(chapterId, chapterStatus === "ready");
  const [copyFailed, setCopyFailed] = useState(false);

  async function copyAll(images: readonly PublicImage[]) {
    setCopyFailed(false);
    try {
      if (!navigator.clipboard) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(publicImageUrlsText(images));
    } catch {
      setCopyFailed(true);
    }
  }

  if (chapterStatus !== "ready")
    return (
      <section
        className="mb-section rounded-xl border border-border bg-surface p-5"
        aria-labelledby="publication-title"
      >
        <h2 id="publication-title" className="mt-0 text-xl font-semibold">
          Publicación e imágenes
        </h2>
        <p className="mb-0 text-muted">
          {chapterStatus === "failed"
            ? "La publicación no está disponible porque el procesamiento falló."
            : "La publicación estará disponible cuando el procesamiento termine."}
        </p>
      </section>
    );

  if (query.isPending)
    return (
      <section
        className="mb-section grid gap-3 rounded-xl border border-border bg-surface p-5"
        aria-labelledby="publication-title"
      >
        <h2 id="publication-title" className="mt-0 text-xl font-semibold">
          Publicación e imágenes
        </h2>
        <Skeleton label="Cargando publicación" />
        <Skeleton label="Cargando imágenes" />
      </section>
    );

  if (
    query.isError &&
    query.error instanceof ApiError &&
    query.error.status === 404
  )
    return (
      <section
        className="mb-section rounded-xl border border-border bg-surface p-5"
        aria-labelledby="publication-title"
      >
        <h2 id="publication-title" className="mt-0 text-xl font-semibold">
          Publicación e imágenes
        </h2>
        <p className="mb-0 text-muted">
          Este Chapter está listo, pero todavía no está publicado.
        </p>
      </section>
    );

  if (query.isError)
    return (
      <section className="mb-section">
        <ErrorState
          title="No se pudo cargar la publicación"
          description={errorMessage(query.error)}
          action={
            <Button type="button" onClick={() => void query.refetch()}>
              Reintentar
            </Button>
          }
        />
      </section>
    );

  const images = sortPublicImages(query.data?.images ?? []);
  if (!images.length)
    return (
      <section
        className="mb-section grid min-h-60 place-content-center justify-items-center rounded-xl border border-border bg-surface p-8 text-center"
        aria-live="polite"
      >
        <span className="text-4xl text-primary" aria-hidden="true">
          ○
        </span>
        <h2 className="mt-3 text-xl font-semibold">Sin imágenes publicadas</h2>
        <p className="mt-1.5 text-muted">El manifest no contiene imágenes.</p>
        <Button className="mt-4" type="button" disabled>
          Copiar todas las URLs
        </Button>
      </section>
    );

  return (
    <section
      className="mb-section rounded-xl border border-border bg-surface p-5"
      aria-labelledby="publication-title"
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="publication-title" className="mt-0 text-xl font-semibold">
            Publicación e imágenes
          </h2>
          <p className="mb-0 text-muted">
            {query.data?.title || `Chapter ${query.data?.chapterNumber}`}
          </p>
        </div>
        <div className="grid justify-items-start gap-1 sm:justify-items-end">
          <Button type="button" onClick={() => void copyAll(images)}>
            Copiar todas las URLs
          </Button>
          {copyFailed ? (
            <span className="text-xs text-danger" role="alert">
              No se pudieron copiar las URLs.
            </span>
          ) : null}
        </div>
      </div>
      <ol className="grid gap-3" aria-label="Imágenes publicadas">
        {images.map((image) => (
          <ImageListItem key={image.id} image={image} />
        ))}
      </ol>
    </section>
  );
}
