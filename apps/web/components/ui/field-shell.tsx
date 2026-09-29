import type { ReactNode, TextareaHTMLAttributes } from "react";

export function FieldShell({
  id,
  label,
  description,
  error,
  required,
  labelHidden = false,
  disabled = false,
  readOnly = false,
  children,
}: {
  id: string;
  label: string;
  description?: string;
  error?: string | undefined;
  required?: boolean;
  labelHidden?: boolean;
  disabled?: boolean | undefined;
  readOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid gap-2 text-sm ${disabled ? "opacity-60" : ""} ${readOnly ? "rounded-control bg-surface-hover/40 p-2" : ""}`}
    >
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
        <p
          id={`${id}-error`}
          role="alert"
          className="m-0 h-4 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-danger"
          title={error}
        >
          {error}
        </p>
      ) : (
        <span aria-hidden="true" className="block h-4" />
      )}
    </div>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}
