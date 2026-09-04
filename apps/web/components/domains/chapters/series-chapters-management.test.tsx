import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Series-scoped Chapters presentation", () => {
  it("uses the Series-scoped query and compact master-detail layout", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/series/[seriesId]/chapters/page.tsx",
      "utf8",
    );

    expect(page).toContain("useChapterList(seriesId)");
    expect(page).not.toContain("useGlobalChapterList");
    expect(page).toContain("xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]");
    expect(page).toContain('placeholder="Buscar capítulos..."');
    expect(page).toContain('aria-label="Estado"');
    expect(page).toContain('aria-label="Responsable"');
    expect(page).not.toContain('aria-label="Serie"');
    expect(page).toContain("setSelectedChapterId(initialChapterId)");
  });

  it("keeps contextual actions, images, and metrics bound to real IDs", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/series/[seriesId]/chapters/page.tsx",
      "utf8",
    );
    const detail = readFileSync(
      "apps/web/components/domains/chapters/chapter-detail-panel.tsx",
      "utf8",
    );

    expect(page).toContain("Crear capítulo");
    expect(page).toContain("useCreateChapter(seriesId)");
    expect(page).toContain("BulkChapterUploadDialog");
    expect(page).toContain("AssignChapterCollaboratorDialog");
    expect(page).toContain("selectedChapterId");
    expect(page).toContain("QuickChapterImagesDialog");
    expect(page).toContain("remainingImages > 0");
    expect(page).toContain("Sin actividad reciente");
    expect(page).toContain("h-52 overflow-y-auto");
    expect(detail).toContain("showMetricsPlaceholder");
    expect(detail).toContain("Métricas");
    expect(detail).toContain("Muy pronto");
    expect(detail).not.toContain("12,450");
  });

  it("gates upload and create entry points independently in the top action bar", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/series/[seriesId]/chapters/page.tsx",
      "utf8",
    );

    expect(page).toContain("actions={");
    expect(page).toContain('className="flex flex-nowrap items-center gap-2"');
    expect(page).toContain("Subir capítulo");
    expect(page).toContain('variant="secondary"');
    expect(page).toContain("seriesCapabilities.data?.capabilities");
    expect(page).toContain('"images.upload"');
    expect(page).toContain("setUploading(true)");
    expect(page).toContain("<BulkChapterUploadDialog");
    expect(page).toContain("open={uploading}");
    expect(page).toContain("Nuevo capítulo");
    expect(page).toContain("seriesCapabilities.data?.capabilities");
    expect(page).toContain('"chapters.create"');
    expect(page).toContain("setCreating(true)");
    expect(page).not.toContain(
      'selectedCapabilities.data?.capabilities,\n    "images.upload"',
    );
    expect(page).not.toContain('role === "admin"');
    expect(page).not.toContain('role === "gestor"');
  });
});
