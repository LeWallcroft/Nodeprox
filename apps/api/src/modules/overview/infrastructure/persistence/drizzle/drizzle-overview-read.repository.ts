import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  lte,
  notInArray,
  sql,
} from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapters,
  images,
  series,
  users,
} from "../../../../../../../../database/schema/index.js";
import type {
  OverviewDailyActivity,
  OverviewActivityItem,
  OverviewReadPort,
  OverviewStorageUsage,
  OverviewTotals,
} from "../../../application/ports/overview-read.port.js";

const MAX_RECENT_ACTIVITY = 50;
const TECHNICAL_AUDIT_ACTIONS = ["chapter.upload.expired"];

export class DrizzleOverviewReadRepository
  implements OverviewReadPort
{
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getTotals(): Promise<OverviewTotals> {
    const [seriesRow, chaptersRow, imagesRow, usersRow] = await Promise.all([
      this.db.select({ value: count() }).from(series),
      this.db.select({ value: count() }).from(chapters),
      this.db.select({ value: count() }).from(images),
      this.db
        .select({ value: count() })
        .from(users)
        .where(eq(users.status, "active")),
    ]);
    return {
      series: seriesRow[0]?.value ?? 0,
      chapters: chaptersRow[0]?.value ?? 0,
      images: imagesRow[0]?.value ?? 0,
      activeUsers: usersRow[0]?.value ?? 0,
    };
  }

  async getRecentActivity(limit: number): Promise<OverviewActivityItem[]> {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(0, Math.min(MAX_RECENT_ACTIVITY, Math.floor(limit)))
      : 0;
    if (safeLimit === 0) return [];

    const rows = await this.db
      .select({
        id: auditLogs.id,
        actorId: auditLogs.actorId,
        actorLabel: sql<string>`coalesce(${users.discordUsername}, ${users.email}, 'Usuario')`,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(
        and(
          isNotNull(auditLogs.actorId),
          notInArray(auditLogs.action, TECHNICAL_AUDIT_ACTIONS),
        ),
      )
      .orderBy(desc(auditLogs.createdAt))
      .limit(safeLimit);

    return rows.map((row) => ({
      id: row.id,
      actor: { id: row.actorId, label: row.actorLabel },
      action: row.action,
      resourceType: row.resourceType,
      resourceLabel: null,
      occurredAt: row.createdAt.toISOString(),
    }));
  }

  async getStorageUsage(): Promise<OverviewStorageUsage> {
    const [row] = await this.db
      .select({ value: sql<number>`coalesce(sum(${images.sizeBytes}), 0)` })
      .from(images);
    return {
      usedBytes: Number(row?.value ?? 0),
      quotaBytes: null,
      source: "database",
    };
  }

  async getActivity7d(): Promise<OverviewDailyActivity[]> {
    const now = new Date(this.now());
    const today = new Date(now);
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - 6);
    const day = (column: typeof series.createdAt | typeof chapters.createdAt) =>
      sql<string>`to_char(date_trunc('day', ${column} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
    const [seriesRows, chapterRows] = await Promise.all([
      this.db
        .select({ date: day(series.createdAt), value: count() })
        .from(series)
        .where(and(gte(series.createdAt, start), lte(series.createdAt, now)))
        .groupBy(day(series.createdAt)),
      this.db
        .select({ date: day(chapters.createdAt), value: count() })
        .from(chapters)
        .where(
          and(gte(chapters.createdAt, start), lte(chapters.createdAt, now)),
        )
        .groupBy(day(chapters.createdAt)),
    ]);
    const seriesByDay = new Map(seriesRows.map((row) => [row.date, row.value]));
    const chaptersByDay = new Map(
      chapterRows.map((row) => [row.date, row.value]),
    );
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return {
        date: key,
        series: seriesByDay.get(key) ?? 0,
        chapters: chaptersByDay.get(key) ?? 0,
      };
    });
  }
}
