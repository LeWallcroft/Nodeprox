export function Skeleton({ label = "Cargando" }: { label?: string }) {
  return (
    <span
      className="skeleton-shimmer block h-[18px] rounded-md"
      role="status"
      aria-label={label}
    />
  );
}
