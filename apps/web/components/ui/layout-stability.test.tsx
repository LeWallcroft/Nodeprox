import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("paginated master-detail layout stability", () => {
  it("reserves the same desktop table viewport across Series and Chapters", () => {
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

    expect(series).toContain('minTableHeightClassName="lg:min-h-[700px]"');
    expect(globalChapters).toContain('minHeightClassName="lg:min-h-[700px]"');
    expect(contextualChapters).toContain(
      'minTableHeightClassName="lg:min-h-[700px]"',
    );
    expect(series).toContain("mt-4 grid gap-4 lg:grid-cols-3");
    expect(globalChapters).toContain("mt-4 grid gap-4 lg:grid-cols-3");
    expect(contextualChapters).toContain("mt-4 grid gap-4 lg:grid-cols-3");
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
    expect(dataTable).toContain("DataTableEmptyRow");
    expect(dataTable).not.toContain("border-collapse ${minHeightClassName");
    expect(pagination).toContain("totalItems");
    expect(pagination).toContain("Página anterior");
    expect(pagination).toContain("Página siguiente");
    expect(imageManagement).toContain("<Pagination");
    expect(imageManagement).not.toContain("page * pageSize + 1");
  });

  it("keeps Global Chapters metrics visual-only", () => {
    const globalChapters = readFileSync(
      "apps/web/app/(dashboard)/chapters/page.tsx",
      "utf8",
    );
    const detail = readFileSync(
      "apps/web/components/domains/chapters/chapter-detail-panel.tsx",
      "utf8",
    );

    expect(globalChapters).toContain("showMetricsPlaceholder");
    expect(detail).toContain("Métricas");
    expect(detail).toContain("Muy pronto");
    expect(detail).not.toContain("12,450");
  });
});
