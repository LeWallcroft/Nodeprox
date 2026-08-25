import { and, count, eq, max, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapters,
  series,
  seriesAssignments,
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

  async listAll() {
    const rows = await this.db.select().from(series);
    return rows.map(toSeries);
  }

  async listAssignedSeriesIds(uploaderId: string) {
    const rows = await this.db
      .select({ seriesId: seriesAssignments.seriesId })
      .from(seriesAssignments)
      .where(eq(seriesAssignments.uploaderId, uploaderId));
    return rows.map((row) => row.seriesId);
  }

  async isAssigned(seriesId: string, uploaderId: string) {
    const [row] = await this.db
      .select({ id: seriesAssignments.id })
      .from(seriesAssignments)
      .where(
        and(
          eq(seriesAssignments.seriesId, seriesId),
          eq(seriesAssignments.uploaderId, uploaderId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async assign(input: {
    seriesId: string;
    uploaderId: string;
    assignedBy: string;
  }) {
    await this.db
      .insert(seriesAssignments)
      .values(input)
      .onConflictDoUpdate({
        target: seriesAssignments.seriesId,
        set: {
          uploaderId: input.uploaderId,
          assignedBy: input.assignedBy,
          updatedAt: new Date(),
        },
      });
  }

  async clear(seriesId: string) {
    await this.db
      .delete(seriesAssignments)
      .where(eq(seriesAssignments.seriesId, seriesId));
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
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.seriesId}, 0))`,
      );
      const [latest] = await tx
        .select({ chapterNumber: max(chapters.chapterNumber) })
        .from(chapters)
        .where(eq(chapters.seriesId, input.seriesId));
      const nextChapterNumber = Number(latest?.chapterNumber ?? 0) + 1;
      if (input.chapterNumber !== nextChapterNumber)
        throw new ChapterSequenceError(nextChapterNumber);
      const [row] = await tx.insert(chapters).values(input).returning();
      if (!row) throw new Error("chapter-create-failed");
      return toChapter(row);
    });
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

  async isAssigned(seriesId: string, uploaderId: string) {
    return new DrizzleSeriesRepository(this.db).isAssigned(
      seriesId,
      uploaderId,
    );
  }

  async isSeriesOwner(seriesId: string, userId: string) {
    const [row] = await this.db
      .select({ id: series.id })
      .from(series)
      .where(and(eq(series.id, seriesId), eq(series.createdBy, userId)))
      .limit(1);
    return Boolean(row);
  }
}

export class ChapterSequenceError extends Error {
  constructor(readonly expected: number) {
    super(`The next chapter number must be ${expected}`);
    this.name = "ChapterSequenceError";
  }
}
