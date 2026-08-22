import { count, eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapters,
  series,
} from "../../../../../../../../database/schema/index.js";
import type {
  ChapterCoreRecord,
  SeriesRecord,
} from "../../../domain/series.types.js";
import type {
  ChapterCoreRepositoryPort,
  SeriesRepositoryPort,
} from "../../../application/ports/series.ports.js";

const toSeries = (row: typeof series.$inferSelect): SeriesRecord => ({
  id: row.id,
  title: row.title,
  slug: row.slug,
  description: row.description,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toChapter = (row: typeof chapters.$inferSelect): ChapterCoreRecord => ({
  id: row.id,
  seriesId: row.seriesId,
  chapterNumber: row.chapterNumber,
  title: row.title,
  status: row.status,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class DrizzleSeriesRepository implements SeriesRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async create(input: {
    title: string;
    slug: string;
    description?: string | null | undefined;
    createdBy: string;
  }) {
    const [row] = await this.db.insert(series).values(input).returning();
    if (!row) throw new Error("series-create-failed");
    return toSeries(row);
  }

  async listByOwner(ownerId: string) {
    const rows = await this.db
      .select()
      .from(series)
      .where(eq(series.createdBy, ownerId));
    return rows.map(toSeries);
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(series)
      .where(eq(series.id, id))
      .limit(1);
    return row ? toSeries(row) : null;
  }

  async update(
    id: string,
    input: {
      title?: string | undefined;
      slug?: string | undefined;
      description?: string | null | undefined;
    },
  ) {
    const [row] = await this.db
      .update(series)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(series.id, id))
      .returning();
    return row ? toSeries(row) : null;
  }

  async delete(id: string) {
    await this.db.delete(series).where(eq(series.id, id));
  }

  async countChapters(id: string) {
    const [row] = await this.db
      .select({ count: count() })
      .from(chapters)
      .where(eq(chapters.seriesId, id));
    return Number(row?.count ?? 0);
  }
}

export class DrizzleChapterCoreRepository implements ChapterCoreRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async create(input: {
    seriesId: string;
    chapterNumber: number;
    title?: string | null | undefined;
    createdBy: string;
  }) {
    const [row] = await this.db.insert(chapters).values(input).returning();
    if (!row) throw new Error("chapter-create-failed");
    return toChapter(row);
  }

  async listBySeries(seriesId: string) {
    const rows = await this.db
      .select()
      .from(chapters)
      .where(eq(chapters.seriesId, seriesId));
    return rows.map(toChapter);
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(chapters)
      .where(eq(chapters.id, id))
      .limit(1);
    return row ? toChapter(row) : null;
  }

  async update(
    id: string,
    input: {
      chapterNumber?: number | undefined;
      title?: string | null | undefined;
    },
  ) {
    const [row] = await this.db
      .update(chapters)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(chapters.id, id))
      .returning();
    return row ? toChapter(row) : null;
  }

  async delete(id: string) {
    await this.db.delete(chapters).where(eq(chapters.id, id));
  }
}
