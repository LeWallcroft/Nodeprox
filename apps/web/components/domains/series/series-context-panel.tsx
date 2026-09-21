import type { ReactNode } from "react";

export function SeriesContextPanel({
  children,
  open,
}: {
  children: ReactNode;
  open: boolean;
}) {
  return (
    <aside
      aria-label="Panel contextual de la serie"
      data-open={open}
      className="min-h-0 w-full xl:h-full xl:self-stretch"
    >
      {children}
    </aside>
  );
}
