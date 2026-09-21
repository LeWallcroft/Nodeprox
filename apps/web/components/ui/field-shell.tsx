import type { ReactNode, TextareaHTMLAttributes } from "react";

export function FieldShell({
  id,
  label,
  description,
  error,
  required,
  labelHidden = false,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string;
  required?: boolean;
  labelHidden?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2 text-sm">
      <label
        className={labelHidden ? "sr-only" : "font-medium text-text-secondary"}
        htmlFor={id}
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-primary">
            *
          </span>
        ) : null}
      </label>
      {children}
      {description ? (
        <p id={`${id}-description`} className="m-0 text-xs text-muted">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="m-0 text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}
