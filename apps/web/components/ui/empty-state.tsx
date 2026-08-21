export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="empty-state" aria-live="polite">
      <span className="empty-state-icon">○</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}
