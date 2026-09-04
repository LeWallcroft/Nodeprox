import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isChapterReplacementActive,
  replacementPhase,
} from "../../../lib/domains/chapter-replacements/hooks";

describe("whole Chapter replacement shared workflow", () => {
  const dialog = readFileSync(
    "apps/web/components/domains/chapters/whole-chapter-replacement-dialog.tsx",
    "utf8",
  );
  const detail = readFileSync(
    "apps/web/components/domains/chapters/chapter-detail-panel.tsx",
    "utf8",
  );
  const images = readFileSync(
    "apps/web/app/(dashboard)/series/[seriesId]/chapters/[chapterId]/images/page.tsx",
    "utf8",
  );
  const hooks = readFileSync(
    "apps/web/lib/domains/chapter-replacements/hooks.ts",
    "utf8",
  );

  it("CHR4-WEB-01 uses one shared Dialog from both capability-based entry points", () => {
    expect(detail).toContain('hasCapability(capabilities, "chapters.replace")');
    expect(detail).toMatch(/Cambiar\s+capítulo/);
    expect(images).toContain('"chapters.replace"');
    expect(images).toMatch(/Cambiar\s+capítulo entero/);
    expect(detail).toContain("<WholeChapterReplacementDialog");
    expect(images).toContain("<WholeChapterReplacementDialog");
  });

  it("CHR4-WEB-02 accepts one ZIP and preserves the frozen explanations", () => {
    expect(dialog).toContain('mode="single"');
    expect(dialog).toContain(
      "El nuevo ZIP sustituirá todas las imágenes actuales del capítulo.",
    );
    expect(dialog).toContain("procesado correctamente");
    expect(dialog).toMatch(/dejarán\s+de formar parte/);
  });

  it("CHR4-WEB-03 maps backend lifecycle without SSE", () => {
    expect(replacementPhase("pending_upload")).toBe("uploading");
    expect(replacementPhase("processing")).toBe("processing");
    expect(replacementPhase("ready")).toBe("applying");
    expect(replacementPhase("completing")).toBe("applying");
    expect(replacementPhase("completed")).toBe("completed");
    expect(isChapterReplacementActive("ready")).toBe(true);
    expect(isChapterReplacementActive("completed")).toBe(false);
    expect(isChapterReplacementActive("failed")).toBe(false);
    expect(hooks).toContain("refetchInterval");
    expect(hooks).toContain("2000");
    expect(hooks).not.toContain("EventSource");
  });

  it("CHR4-WEB-04 invalidates only exact canonical Chapter projections", () => {
    expect(hooks).toContain("queryKeys.publication.chapter(input.chapterId)");
    expect(hooks).toContain("queryKeys.chapters.detail(input.chapterId)");
    expect(hooks).toContain("queryKeys.series.chapters(input.seriesId)");
    expect(hooks).toContain("queryKeys.chapters.list");
    expect(hooks).not.toContain("queryKeys.auth");
    expect(hooks).not.toContain("router.refresh");
  });

  it("CHR4-WEB-05 reconciles retained and retired focus/bulk IDs from canonical images", () => {
    expect(images).toContain("canonicalIds.has(current)");
    expect(images).toContain("canonicalIds.has(imageId)");
    expect(images).not.toContain("imageVersionId");
  });

  it("CHR4-WEB-06 leaves existing initial upload actions intact", () => {
    expect(detail).toContain("Subir ZIP");
    expect(detail).toContain("UploadForm");
    expect(dialog).not.toContain("_v2");
    expect(dialog).not.toContain("candidateStorageKey");
  });

  it("PROXY-CHR4-06 distinguishes start failure from backend processing failure", () => {
    expect(dialog).toContain("No se pudo iniciar el reemplazo del capítulo.");
    expect(dialog).toContain('workflow.projection?.status === "failed"');
    expect(dialog).toContain("No se pudo procesar el capítulo");
  });
});
