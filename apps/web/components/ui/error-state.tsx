export function ErrorState({
  title = "Algo salió mal",
  description,
}: {
  title?: string;
  description: string;
}) {
  return (
    <section className="empty-state" role="alert">
      <span className="empty-state-icon" aria-hidden="true">
        !
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  );
}
