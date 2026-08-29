import type { ReactNode } from "react";

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: ReactNode;
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "bg-surface-elevated text-muted",
    info: "bg-primary-soft text-info",
    success: "bg-success-soft text-success",
    warning: "bg-warning-soft text-warning",
    danger: "bg-danger-soft text-danger",
  }[tone];
  return (
    <span
      className={`inline-flex min-h-6 w-fit items-center rounded-full px-2 text-xs font-medium ${toneClass}`}
    >
      {label}
    </span>
  );
}
