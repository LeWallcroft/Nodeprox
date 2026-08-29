"use client";

import { useState } from "react";

export function SeriesCoverPreview({
  coverUrl,
  title,
  compact = false,
}: {
  coverUrl: string | null;
  title: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<"loading" | "loaded" | "error">(
    coverUrl ? "loading" : "error",
  );
  const size = compact ? "h-10 w-10" : "aspect-[16/9] w-full";

  if (!coverUrl || state === "error") {
    return (
      <div
        aria-label="Portada no disponible"
        className={`grid ${size} place-items-center rounded-control border border-border bg-surface-elevated text-xs font-semibold text-muted`}
        role="img"
      >
        {compact ? title.slice(0, 1).toUpperCase() : "Sin portada"}
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-control bg-surface-elevated ${size}`}>
      {state === "loading" ? (
        <div
          aria-label="Cargando portada"
          className="absolute inset-0 animate-pulse bg-hover"
          role="status"
        />
      ) : null}
      {/* biome-ignore lint/performance/noImgElement: external covers must not depend on a Next remote-host allowlist. */}
      <img
        alt={`Portada de ${title}`}
        className="h-full w-full object-cover"
        src={coverUrl}
        onError={() => setState("error")}
        onLoad={() => setState("loaded")}
      />
    </div>
  );
}
