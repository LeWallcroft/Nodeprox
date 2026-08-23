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
    <nav className="pagination" aria-label="Paginación">
      <button
        className="button button-secondary"
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
        className="button button-secondary"
        type="button"
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
      >
        Siguiente
      </button>
    </nav>
  );
}
