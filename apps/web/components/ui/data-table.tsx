import type { ReactNode } from "react";

export function DataTable({
  children,
  label = "Datos",
}: {
  children: ReactNode;
  label?: string;
}) {
  return (
    <div className="overflow-x-auto rounded-panel border border-border bg-surface shadow-card">
      <table
        className="w-full min-w-[640px] border-collapse"
        aria-label={label}
      >
        {children}
      </table>
    </div>
  );
}
