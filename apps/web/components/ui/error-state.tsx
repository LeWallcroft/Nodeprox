import type { ReactNode } from "react";

export function ErrorState({
  title = "Algo salió mal",
  description,
  action,
}: {
  title?: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="empty-state" role="alert">
      <span className="empty-state-icon" aria-hidden="true">
        !
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </section>
  );
}
