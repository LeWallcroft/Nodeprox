import { Skeleton } from "./skeleton";

export function LoadingState({
  label = "Cargando contenido",
}: {
  label?: string;
}) {
  return (
    <section
      className="grid gap-3 rounded-panel border border-border bg-surface p-5 shadow-card"
      aria-label={label}
    >
      <Skeleton label={label} />
      <Skeleton label={label} />
      <Skeleton label={label} />
    </section>
  );
}
