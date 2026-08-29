import type { ReactNode } from "react";

export function PageSection({
  title,
  description,
  children,
  className = "",
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-section ${className}`.trim()}>
      {title ? <h2 className="m-0 text-xl font-semibold">{title}</h2> : null}
      {description ? (
        <p className="mt-1.5 text-sm text-muted">{description}</p>
      ) : null}
      <div className={title || description ? "mt-4" : ""}>{children}</div>
    </section>
  );
}
