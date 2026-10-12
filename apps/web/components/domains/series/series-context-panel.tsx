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
      className="relative min-h-[420px] w-full xl:min-h-0 xl:self-stretch"
    >
      <div className="xl:absolute xl:inset-0">{children}</div>
    </aside>
  );
}
