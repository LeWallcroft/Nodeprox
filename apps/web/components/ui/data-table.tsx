import type { ReactNode } from "react";

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
    <div className="overflow-x-auto rounded-panel border border-border bg-surface shadow-card">
      <table
        className={`w-full min-w-[640px] border-collapse ${minHeightClassName ?? ""}`}
        aria-label={label}
        data-paginated-table-viewport={minHeightClassName ? "fixed" : undefined}
      >
        {children}
      </table>
    </div>
  );
}
