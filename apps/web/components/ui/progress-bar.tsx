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
      className="progress-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={boundedValue}
    >
      <span style={{ width: `${boundedValue}%` }} />
    </div>
  );
}
