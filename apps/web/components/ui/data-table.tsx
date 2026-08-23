import type { ReactNode } from "react";

export function DataTable({
  children,
  label = "Datos",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="data-table-wrap">
      <table className="data-table" aria-label={label}>
        {children}
      </table>
    </div>
  );
}
