import type { ButtonHTMLAttributes } from "react";

export function Button({
  className = "",
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "destructive";
}) {
  const variantClass = {
    primary:
      "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover",
    secondary: "border-border bg-surface text-text hover:bg-surface-hover",
    destructive:
      "border-destructive-border bg-destructive-surface text-destructive-text hover:border-destructive-border-hover hover:text-destructive-text-hover focus-visible:outline-destructive-border-hover",
  }[variant];
  return (
    <button
      className={`inline-flex min-h-control items-center justify-center gap-2 rounded-control border px-3.5 font-medium shadow-card transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${variantClass} ${className}`.trim()}
      {...props}
    />
  );
}
