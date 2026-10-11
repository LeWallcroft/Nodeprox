import { describe, expect, it } from "vitest";
import { resolveChapterImagePresentation } from "./chapter-image-presentation";

describe("chapter image presentation", () => {
  it("shows the approved empty notice for a draft with a confirmed zero count", () => {
    expect(resolveChapterImagePresentation("draft", 0)).toEqual({
      kind: "empty",
      label: "Este capítulo aún no tiene imágenes.",
    });
  });

  it("keeps a positive count available regardless of the lifecycle label", () => {
    expect(resolveChapterImagePresentation("ready", 3)).toEqual({
      kind: "available",
    });
  });

  it("prioritizes a persisted active state over an image count", () => {
    expect(resolveChapterImagePresentation("processing", 8)).toEqual({
      kind: "processing",
      label: "Las imágenes se están procesando.",
    });
  });

  it.each([
    ["uploading", "Se están cargando las imágenes."],
    ["uploaded", "Las imágenes están pendientes de procesamiento."],
    ["processing", "Las imágenes se están procesando."],
  ] as const)("does not show an empty notice while %s", (status, label) => {
    expect(resolveChapterImagePresentation(status, 0)).toEqual({
      kind: "processing",
      label,
    });
  });

  it("uses history-safe wording for zero counts outside the initial draft", () => {
    expect(resolveChapterImagePresentation("failed", 0)).toEqual({
      kind: "empty",
      label: "No hay imágenes asociadas actualmente.",
    });
    expect(resolveChapterImagePresentation("ready", 0)).toEqual({
      kind: "empty",
      label: "No hay imágenes asociadas actualmente.",
    });
  });

  it("does not infer absence from an unknown count or a deleting chapter", () => {
    expect(resolveChapterImagePresentation("draft", undefined)).toEqual({
      kind: "unknown",
    });
    expect(resolveChapterImagePresentation("deleting", 0)).toEqual({
      kind: "unknown",
    });
  });
});
