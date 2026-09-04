"use client";

import { ImageOff } from "lucide-react";
import { type ReactNode, useState } from "react";

export type ContentImageVariant =
  | "thumbnail"
  | "cover"
  | "details"
  | "avatar"
  | "preview";

const sizes: Record<ContentImageVariant, string> = {
  thumbnail: "h-10 w-10",
  cover: "aspect-[16/9] w-full",
  details: "h-24 w-28",
  avatar: "h-9 w-9 rounded-full",
  preview: "aspect-square w-full",
};

const fit: Record<ContentImageVariant, string> = {
  thumbnail: "object-cover",
  cover: "object-contain",
  details: "object-contain",
  avatar: "object-cover",
  preview: "object-contain",
};

export function ContentImage({
  src,
  alt,
  variant,
  fallback,
}: {
  src: string | null | undefined;
  alt: string;
  variant: ContentImageVariant;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  const unavailable = !src || failed;

  return (
    <div
      className={`relative grid shrink-0 overflow-hidden rounded-control border border-border bg-surface-elevated ${sizes[variant]}`}
    >
      {unavailable ? (
        <div className="grid h-full w-full place-items-center text-muted">
          <span className="sr-only">{alt} no disponible</span>
          {fallback ?? <ImageOff aria-hidden="true" className="size-4" />}
        </div>
      ) : (
        /* biome-ignore lint/performance/noImgElement: canonical public media must not depend on a Next remote-host allowlist. */
        <img
          alt={alt}
          className={`h-full w-full object-center ${fit[variant]}`}
          src={src}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
