import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DataTable,
  DataTableEmptyRow,
  getSelectableTableRowProps,
  stopTableRowSelection,
} from "./data-table";
import { Pagination } from "./pagination";

describe("shared table pagination", () => {
  it("keeps a single data row intrinsic while the viewport reserves height", () => {
    const markup = renderToStaticMarkup(
      <DataTable label="Resultados" minHeightClassName="lg:min-h-[700px]">
        <thead>
          <tr>
            <th>Nombre</th>
          </tr>
        </thead>
        <tbody>
          <tr data-row="result">
            <td>Único resultado</td>
          </tr>
        </tbody>
      </DataTable>,
    );

    expect(markup).toContain('data-paginated-table-viewport="fixed"');
    expect(markup).toContain('aria-label="Resultados"');
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain('data-row="result"');
    expect(markup).not.toContain("h-full");
  });

  it("renders a dedicated empty state instead of a data row", () => {
    const markup = renderToStaticMarkup(
      <table>
        <tbody>
          <DataTableEmptyRow colSpan={2} />
        </tbody>
      </table>,
    );

    expect(markup).toContain('data-table-empty-state="true"');
    expect(markup).toContain("No se encontraron resultados.");
  });

  it.each([
    [1, 3, true, false],
    [3, 3, false, true],
    [1, 1, true, true],
  ])(
    "renders compact controls for page %i of %i",
    (page, totalPages, previousDisabled, nextDisabled) => {
      const markup = renderToStaticMarkup(
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={47}
          onPrevious={() => undefined}
          onNext={() => undefined}
        />,
      );

      expect(markup).toContain(`Página ${page} de ${totalPages}`);
      expect(markup).toContain("47 resultados");
      const buttons = [...markup.matchAll(/<button[^>]*>/g)].map((match) =>
        /\sdisabled(?:=""|(?=\s|>))/.test(match[0]),
      );
      expect(buttons).toEqual([previousDisabled, nextDisabled]);
    },
  );

  it("uses the singular result label", () => {
    const markup = renderToStaticMarkup(
      <Pagination
        page={1}
        totalPages={1}
        totalItems={1}
        onPrevious={() => undefined}
        onNext={() => undefined}
      />,
    );

    expect(markup).toContain("1 resultado");
    expect(markup).not.toContain("1 resultados");
  });

  it("selects a row with click, Enter, or Space without responding to descendant keys", () => {
    let selections = 0;
    const props = getSelectableTableRowProps(() => {
      selections += 1;
    });
    const row = {} as HTMLTableRowElement;
    const child = {} as HTMLElement;

    props.onClick();
    props.onKeyDown({
      currentTarget: row,
      target: row,
      key: "Enter",
      preventDefault: () => undefined,
    } as never);
    props.onKeyDown({
      currentTarget: row,
      target: row,
      key: " ",
      preventDefault: () => undefined,
    } as never);
    props.onKeyDown({
      currentTarget: row,
      target: child,
      key: "Enter",
      preventDefault: () => undefined,
    } as never);

    expect(selections).toBe(3);
  });

  it("stops row selection for an inner action", () => {
    let stopped = false;
    stopTableRowSelection({
      stopPropagation: () => {
        stopped = true;
      },
    } as never);
    expect(stopped).toBe(true);
  });
});
