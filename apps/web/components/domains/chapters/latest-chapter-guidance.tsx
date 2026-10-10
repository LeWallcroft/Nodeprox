import { BookOpenCheck } from "lucide-react";

export function LatestChapterGuidance({
  chapterNumber,
}: {
  chapterNumber: number | null | undefined;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-control border-l-4 border-primary bg-primary-soft px-3.5 py-3 text-text shadow-card"
      role="status"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
        <BookOpenCheck aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-secondary">
          Referencia de la serie
        </span>
        <span className="block text-sm font-semibold text-text">
          {chapterNumber == null
            ? "Aún no hay capítulos en esta serie."
            : "Último capítulo visible"}
        </span>
      </span>
      {chapterNumber != null ? (
        <span className="rounded-full bg-surface px-3 py-1 text-base font-bold tabular-nums text-primary shadow-card">
          {chapterNumber}
        </span>
      ) : null}
    </div>
  );
}
