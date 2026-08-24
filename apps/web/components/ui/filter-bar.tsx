import type { ReactNode } from "react";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0">
      <legend className="sr-only">Filtros</legend>
      {children}
    </fieldset>
  );
}
