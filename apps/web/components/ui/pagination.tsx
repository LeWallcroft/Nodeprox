import { ChevronLeft, ChevronRight } from "lucide-react";

export function Pagination({
  page,
  totalPages,
  totalItems,
  onPrevious,
  onNext,
  isLoading = false,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPrevious: () => void;
  onNext: () => void;
  isLoading?: boolean;
}) {
  const resolvedTotalPages = Math.max(1, totalPages);
  const resolvedPage = Math.min(Math.max(1, page), resolvedTotalPages);
  const resultLabel = `${totalItems} ${totalItems === 1 ? "resultado" : "resultados"}`;

  return (
    <nav
      className="flex w-full flex-col gap-2 text-sm text-muted sm:flex-row sm:items-center sm:justify-between"
      aria-label="Paginación"
    >
      <span>{resultLabel}</span>
      <div className="flex items-center gap-1 self-end sm:self-auto">
        <button
          aria-label="Página anterior"
          className="inline-flex size-8 items-center justify-center rounded-control border border-border bg-surface text-text hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          disabled={isLoading || resolvedPage <= 1}
          onClick={onPrevious}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </button>
        <span aria-live="polite" className="px-2 whitespace-nowrap">
          Página {resolvedPage} de {resolvedTotalPages}
        </span>
        <button
          aria-label="Página siguiente"
          className="inline-flex size-8 items-center justify-center rounded-control border border-border bg-surface text-text hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
          type="button"
          disabled={isLoading || resolvedPage >= resolvedTotalPages}
          onClick={onNext}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </button>
      </div>
    </nav>
  );
}
