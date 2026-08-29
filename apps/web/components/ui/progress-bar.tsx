export function ProgressBar({
  value,
  label = "Progreso",
}: {
  value: number;
  label?: string;
}) {
  const boundedValue = Math.min(100, Math.max(0, value));
  return (
    <div
      className="h-2 overflow-hidden rounded-full bg-surface-elevated"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={boundedValue}
    >
      <span
        className="block h-full rounded-full bg-primary transition-[width] duration-200"
        style={{ width: `${boundedValue}%` }}
      />
    </div>
  );
}
