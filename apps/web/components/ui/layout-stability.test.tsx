import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("paginated master-detail layout stability", () => {
  it("reserves bounded desktop table viewports across Series and Chapters", () => {
    const series = readFileSync(
      "apps/web/app/(dashboard)/series/page.tsx",
      "utf8",
    );
    const globalChapters = readFileSync(
      "apps/web/app/(dashboard)/chapters/page.tsx",
      "utf8",
    );
    const contextualChapters = readFileSync(
      "apps/web/app/(dashboard)/series/[seriesId]/chapters/page.tsx",
      "utf8",
    );

    expect(series).toContain('minTableHeightClassName="lg:min-h-[640px]"');
    expect(globalChapters).toContain('minHeightClassName="lg:min-h-[700px]"');
    expect(contextualChapters).toContain(
      'minTableHeightClassName="lg:min-h-[700px]"',
    );
    expect(series).not.toContain("mt-4 grid gap-4 lg:grid-cols-3");
    expect(globalChapters).not.toContain("mt-4 grid gap-4 lg:grid-cols-3");
    expect(contextualChapters).not.toContain("mt-4 grid gap-4 lg:grid-cols-3");
  });

  it("uses the shared non-expanding viewport and pagination across paginated master-detail tables", () => {
    const dataTable = readFileSync(
      "apps/web/components/ui/data-table.tsx",
      "utf8",
    );
    const pagination = readFileSync(
      "apps/web/components/ui/pagination.tsx",
      "utf8",
    );
    const imageManagement = readFileSync(
      "apps/web/app/(dashboard)/series/[seriesId]/chapters/[chapterId]/images/page.tsx",
      "utf8",
    );

    expect(dataTable).toContain("data-paginated-table-viewport");
    expect(dataTable).toContain("data-table-filler");
    expect(dataTable).toContain('aria-hidden="true"');
    expect(dataTable).toContain(
      "table-filler min-h-0 min-w-[640px] flex-1 bg-surface",
    );
    expect(dataTable).toContain("scrollbar-gutter:stable");
    expect(dataTable).toContain("DataTableEmptyRow");
    expect(dataTable).not.toContain("border-collapse ${minHeightClassName");
    expect(pagination).toContain("totalItems");
    expect(pagination).toContain("Página anterior");
    expect(pagination).toContain("Página siguiente");
    expect(imageManagement).toContain("<Pagination");
    expect(imageManagement).not.toContain("page * pageSize + 1");
  });

  it("keeps the Series workspace geometry independent from selection state", () => {
    const page = readFileSync(
      "apps/web/app/(dashboard)/series/page.tsx",
      "utf8",
    );
    const detail = readFileSync(
      "apps/web/components/domains/series/series-detail-panel.tsx",
      "utf8",
    );
    const detailShell = readFileSync(
      "apps/web/components/ui/detail-panel.tsx",
      "utf8",
    );
    const list = readFileSync(
      "apps/web/components/domains/series/series-list.tsx",
      "utf8",
    );

    expect(page).toContain("xl:grid-cols-[minmax(0,1fr)_minmax(380px,420px)]");
    expect(page).not.toContain('selectedSeriesId ? "grid-cols');
    expect(page).toContain("<SeriesDetailPanel");
    expect(detail).toContain("<DetailPanel>");
    expect(detailShell).toContain("xl:h-full");
    expect(list).toContain("h-[76px]");
    expect(list).toContain('index === items.length - 1 ? "border-b-0"');
    expect(list).toContain("grid-rows-[2rem_1rem]");
    expect(list).toContain("line-clamp-2 h-8 overflow-hidden");
    expect(list).toContain("h-4 max-w-[18rem] truncate");
    expect(list).not.toContain('selected ? "border-2"');
    expect(list).not.toContain("transition-all");
  });

  it("keeps the reserved table surface free of pseudo-row separators", () => {
    const styles = readFileSync("apps/web/app/globals.css", "utf8");
    const dataTable = readFileSync(
      "apps/web/components/ui/data-table.tsx",
      "utf8",
    );

    expect(styles).not.toContain("repeating-linear-gradient");
    expect(styles).not.toContain(".table-filler");
    expect(dataTable).toContain("<table");
    expect(dataTable).toContain('data-table-filler="true"');
    expect(dataTable).toContain('aria-hidden="true"');
  });

  it("keeps Global Chapters detail data in the stable shared panel", () => {
    const globalChapters = readFileSync(
      "apps/web/app/(dashboard)/chapters/page.tsx",
      "utf8",
    );
    const detail = readFileSync(
      "apps/web/components/domains/chapters/chapter-detail-panel.tsx",
      "utf8",
    );

    expect(globalChapters).toContain("globalChapter={selectedChapter}");
    expect(detail).toContain("<DetailPanel>");
    expect(detail).toContain('label="Imágenes"');
    expect(detail).toContain('label="Responsable"');
  });

  it("bounds the Audit event detail shell to the same desktop height as its table", () => {
    const audit = readFileSync(
      "apps/web/app/(dashboard)/admin/audit/page.tsx",
      "utf8",
    );

    expect(audit).toContain('className="min-h-[420px] xl:h-[640px]"');
    expect(audit).toContain("<DetailPanelContent scrollable>");
  });
});
