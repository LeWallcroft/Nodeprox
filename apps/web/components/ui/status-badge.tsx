export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass = {
    neutral: "bg-[#eef1f5] text-[#536273]",
    success: "bg-[#e7f7ee] text-[#187344]",
    warning: "bg-[#fff5db] text-[#916b00]",
    danger: "bg-[#ffebeb] text-[#a52f2f]",
  }[tone];
  return (
    <span
      className={`inline-flex min-h-6 w-fit items-center rounded-full px-2 text-xs font-bold ${toneClass}`}
    >
      {label}
    </span>
  );
}
