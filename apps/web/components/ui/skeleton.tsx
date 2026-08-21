export function Skeleton({ label = "Cargando" }: { label?: string }) {
  return <span className="skeleton" role="status" aria-label={label} />;
}
