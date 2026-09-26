import type { OverviewDailyActivity } from "../../../lib/domains/overview/types";

export function OverviewActivityChart({
  points,
}: {
  points: OverviewDailyActivity[];
}) {
  const width = 640;
  const height = 224;
  const left = 34;
  const right = 12;
  const top = 20;
  const bottom = 32;
  const max = Math.max(
    1,
    ...points.flatMap((point) => [point.series, point.chapters]),
  );
  const x = (index: number) =>
    left + (index * (width - left - right)) / Math.max(1, points.length - 1);
  const y = (value: number) =>
    top + (1 - value / max) * (height - top - bottom);
  const line = (key: "series" | "chapters") =>
    points.map((point, index) => `${x(index)},${y(point[key])}`).join(" ");
  const empty = points.every(
    (point) => point.series === 0 && point.chapters === 0,
  );

  return (
    <div className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-secondary">
        <span className="inline-flex items-center gap-2">
          <i className="size-2 rounded-full bg-primary" />
          Series
        </span>
        <span className="inline-flex items-center gap-2">
          <i className="size-2 rounded-full bg-info" />
          Capítulos
        </span>
      </div>
      <svg
        className="h-auto w-full"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Actividad de series y capítulos durante los últimos siete días"
      >
        <line
          x1={left}
          x2={width - right}
          y1={y(0)}
          y2={y(0)}
          className="stroke-border"
          strokeWidth="1"
        />
        <text x="4" y={top + 4} className="fill-muted text-[10px]">
          {max}
        </text>
        <text x="4" y={y(0)} className="fill-muted text-[10px]">
          0
        </text>
        <polyline
          points={line("series")}
          className="fill-none stroke-primary"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={line("chapters")}
          className="fill-none stroke-info"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {points.map((point, index) => (
          <g key={point.date}>
            <circle
              cx={x(index)}
              cy={y(point.series)}
              r="3"
              className="fill-primary"
            >
              <title>{`${point.date}: ${point.series} series`}</title>
            </circle>
            <circle
              cx={x(index)}
              cy={y(point.chapters)}
              r="3"
              className="fill-info"
            >
              <title>{`${point.date}: ${point.chapters} capítulos`}</title>
            </circle>
            <text
              x={x(index)}
              y={height - 10}
              textAnchor="middle"
              className="fill-muted text-[10px]"
            >
              {point.date.slice(8)}
            </text>
          </g>
        ))}
      </svg>
      {empty ? (
        <p className="mt-2 text-sm text-muted">
          Sin actividad en los últimos 7 días.
        </p>
      ) : null}
    </div>
  );
}
