import type { ReactNode } from "react";

export function DataTable({
  children,
  label = "Datos",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse bg-surface" aria-label={label}>
        {children}
      </table>
    </div>
  );
}
