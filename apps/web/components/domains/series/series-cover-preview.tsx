import { ContentImage } from "../../ui/content-image";

export function SeriesCoverPreview({
  coverUrl,
  title,
  compact = false,
}: {
  coverUrl: string | null;
  title: string;
  compact?: boolean;
}) {
  return (
    <ContentImage
      alt={`Portada de ${title}`}
      fallback={compact ? title.slice(0, 1).toUpperCase() : "Sin portada"}
      src={coverUrl}
      variant={compact ? "thumbnail" : "cover"}
    />
  );
}
