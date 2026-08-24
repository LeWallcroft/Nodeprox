export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section
      className="grid min-h-60 place-content-center justify-items-center rounded-xl border border-border bg-surface p-8 text-center"
      aria-live="polite"
    >
      <span className="text-4xl text-primary" aria-hidden="true">
        ○
      </span>
      <h2 className="mt-3 text-xl font-semibold">{title}</h2>
      <p className="mt-1.5 text-muted">{description}</p>
    </section>
  );
}
