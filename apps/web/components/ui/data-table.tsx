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
}: {
  children: ReactNode;
  label?: string;
  minHeightClassName?: string;
}) {
  return (
    <div
      className={`overflow-x-auto rounded-panel border border-border bg-surface shadow-card ${minHeightClassName ?? ""}`}
      data-paginated-table-viewport={minHeightClassName ? "fixed" : undefined}
    >
      <table
        className="w-full min-w-[640px] border-collapse"
        aria-label={label}
      >
        {children}
      </table>
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
