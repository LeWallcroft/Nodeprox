import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export function getSelectableTableRowProps(onSelect: () => void) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onSelect();
    },
  };
}

export function stopTableRowSelection(event: MouseEvent<HTMLElement>): void {
  event.stopPropagation();
}

export function DataTable({
  children,
  label = "Datos",
  minHeightClassName,
  fillRemainingSpace = false,
  tableClassName,
}: {
  children: ReactNode;
  label?: string;
  minHeightClassName?: string;
  fillRemainingSpace?: boolean;
  tableClassName?: string;
}) {
  return (
    <div
      className={`flex flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-card ${minHeightClassName ?? ""}`}
      data-paginated-table-viewport={minHeightClassName ? "fixed" : undefined}
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-x-auto [scrollbar-gutter:stable]">
        <table
          className={`w-full min-w-[640px] shrink-0 border-collapse ${tableClassName ?? ""}`}
          aria-label={label}
        >
          {children}
        </table>
        {fillRemainingSpace ? (
          <div
            aria-hidden="true"
            className="table-filler min-h-0 min-w-[640px] flex-1 bg-surface"
            data-table-filler="true"
          />
        ) : null}
      </div>
    </div>
  );
}

export function DataTableEmptyRow({
  colSpan,
  title = "No se encontraron resultados.",
  description,
}: {
  colSpan: number;
  title?: string;
  description?: string;
}) {
  return (
    <tr data-table-empty-state="true">
      <td className="p-6 text-center text-sm text-muted" colSpan={colSpan}>
        <p className="m-0 font-medium text-text">{title}</p>
        {description ? <p className="mb-0 mt-1">{description}</p> : null}
      </td>
    </tr>
  );
}
