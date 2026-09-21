import type { ReactNode } from "react";

export function DetailPanel({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-[420px] flex-col overflow-hidden rounded-panel border border-border bg-surface shadow-card xl:h-full">
      {children}
    </section>
  );
}
export function DetailPanelHeader({ children }: { children: ReactNode }) {
  return (
    <header className="shrink-0 border-b border-border p-4">{children}</header>
  );
}
export function DetailPanelContent({
  children,
  scrollable = false,
}: {
  children: ReactNode;
  scrollable?: boolean;
}) {
  return (
    <div
      className={`min-h-0 flex-1 p-4 ${scrollable ? "overflow-y-auto" : "overflow-hidden"}`}
    >
      {children}
    </div>
  );
}
export function DetailPanelActions({ children }: { children: ReactNode }) {
  return (
    <footer className="grid shrink-0 gap-2 border-t border-border bg-surface p-4">
      {children}
    </footer>
  );
}
