import type { Chapter } from "../../../lib/domains/chapters/types";

export type ChapterImagePresentation =
  | { kind: "unknown" }
  | { kind: "available" }
  | { kind: "processing"; label: string }
  | { kind: "empty"; label: string };

export function resolveChapterImagePresentation(
  status: Chapter["status"],
  imageCount: number | undefined,
): ChapterImagePresentation {
  if (status === "uploading")
    return { kind: "processing", label: "Se están cargando las imágenes." };
  if (status === "uploaded")
    return {
      kind: "processing",
      label: "Las imágenes están pendientes de procesamiento.",
    };
  if (status === "processing")
    return { kind: "processing", label: "Las imágenes se están procesando." };
  if (status === "deleting") return { kind: "unknown" };

  if (imageCount === undefined || !Number.isFinite(imageCount))
    return { kind: "unknown" };
  if (imageCount > 0) return { kind: "available" };

  if (status === "draft")
    return { kind: "empty", label: "Este capítulo aún no tiene imágenes." };

  // A zero count can coexist with retained upload or storage history. Keep
  // this wording about current availability rather than implying no history.
  return {
    kind: "empty",
    label: "No hay imágenes asociadas actualmente.",
  };
}
