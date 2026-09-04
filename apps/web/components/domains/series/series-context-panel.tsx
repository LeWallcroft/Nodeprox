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
      className="min-h-0 w-full overflow-y-auto xl:sticky xl:top-4 xl:max-h-[calc(100vh-2rem)]"
    >
      {children}
    </aside>
  );
}
