import type { ReactNode } from "react";

export function FilterBar({ children }: { children: ReactNode }) {
  return (
    <fieldset className="filter-bar">
      <legend className="sr-only">Filtros</legend>
      {children}
    </fieldset>
  );
}
