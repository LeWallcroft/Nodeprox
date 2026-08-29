export function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <article className="grid gap-2 rounded-panel border border-border bg-surface p-[18px] shadow-card">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <strong className="text-[28px] font-semibold">{value}</strong>
      {detail ? <span className="text-muted">{detail}</span> : null}
    </article>
  );
}
