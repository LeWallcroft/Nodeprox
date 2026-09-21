import type { ButtonHTMLAttributes, ReactNode } from "react";
import { LoaderCircle } from "lucide-react";

export function Button({
  className = "",
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
}) {
  const variantClass = {
    primary:
      "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover",
    secondary: "border-border bg-surface text-text hover:bg-surface-hover",
    ghost:
      "border-transparent bg-transparent text-text-secondary hover:bg-surface-hover hover:text-text",
    destructive:
      "border-destructive-border bg-destructive-surface text-destructive-text hover:border-destructive-border-hover hover:text-destructive-text-hover focus-visible:outline-destructive-border-hover",
  }[variant];
  return (
    <button
      className={`inline-flex min-h-control items-center justify-center gap-2 rounded-control border px-3.5 font-medium shadow-card transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${variantClass} ${size === "sm" ? "min-h-8 px-2.5 text-xs" : size === "lg" ? "min-h-11 px-5 text-sm" : "text-sm"} ${className}`.trim()}
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}
