import type { HTMLAttributes } from "react";

export function Card({
  density = "comfortable",
  className = "",
  ...props
}: HTMLAttributes<HTMLElement> & {
  density?: "comfortable" | "compact";
}) {
  const padding = density === "compact" ? "p-3" : "p-5";
  return (
    <section
      className={`rounded-panel border border-border bg-surface ${padding} shadow-card ${className}`.trim()}
      {...props}
    />
  );
}
