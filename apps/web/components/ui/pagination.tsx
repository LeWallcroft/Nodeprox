export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  return (
    <nav className="flex flex-wrap items-center gap-2" aria-label="Paginación">
      <button
        className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3.5 font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Anterior
      </button>
      <span aria-live="polite">
        Página {page} de {totalPages}
      </span>
      <button
        className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3.5 font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}
