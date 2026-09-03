import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterImportBatches,
  chapterImportItems,
  chapters,
  images,
  uploads,
} from "../../../../../../../../database/schema/index.js";
import { ChapterNumber } from "../../../../chapters/domain/chapter-number.js";
import type {
  ImportBatchRepositoryPort,
  ImportChapterLookupPort,
  ImportItemProjection,
} from "../../../application/ports.js";

export class DrizzleImportBatchRepository
  implements ImportBatchRepositoryPort, ImportChapterLookupPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async reserve(input: {
    id: string;
    seriesId: string;
    createdBy: string;
    items: readonly {
      clientId: string;
      chapterNumber: number;
      filename: string;
    }[];
  }): ReturnType<ImportBatchRepositoryPort["reserve"]> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.createdBy}, 0))`,
      );
      const activeStatuses = [
        "pending",
        "uploading",
        "uploaded",
        "processing",
      ] as const;
      const [usage] = await tx
        .select({
          activeItems: sql<number>`count(${chapterImportItems.id})::int`,
          activeSeries: sql<number>`count(distinct ${chapterImportBatches.seriesId})::int`,
          currentSeriesActive: sql<boolean>`coalesce(bool_or(${chapterImportBatches.seriesId} = ${input.seriesId}), false)`,
        })
        .from(chapterImportItems)
        .innerJoin(
          chapterImportBatches,
          eq(chapterImportBatches.id, chapterImportItems.batchId),
        )
        .where(
          and(
            eq(chapterImportBatches.createdBy, input.createdBy),
            inArray(chapterImportItems.status, activeStatuses),
          ),
        );
      const activeItems = usage?.activeItems ?? 0;
      const activeSeries = usage?.activeSeries ?? 0;
      if (!usage?.currentSeriesActive && activeSeries >= 3)
        return {
          outcome: "limited" as const,
          reason: "bulk-active-series-limit" as const,
        };
      if (activeItems + input.items.length > 45)
        return {
          outcome: "limited" as const,
          reason: "bulk-active-item-limit" as const,
        };

      await tx.insert(chapterImportBatches).values({
        id: input.id,
        seriesId: input.seriesId,
        createdBy: input.createdBy,
      });
      const rows = await tx
        .insert(chapterImportItems)
        .values(
          input.items.map((item) => ({
            batchId: input.id,
            clientId: item.clientId,
            chapterNumber: ChapterNumber.parse(item.chapterNumber).toNumber(),
            filename: item.filename,
            status: "pending" as const,
          })),
        )
        .returning({
          id: chapterImportItems.id,
          clientId: chapterImportItems.clientId,
        });
      return {
        outcome: "reserved" as const,
        items: rows.map((row) => ({ itemId: row.id, clientId: row.clientId })),
      };
    });
  }

  async attachUpload(input: { itemId: string; uploadId: string }) {
    const [item] = await this.db
      .update(chapterImportItems)
      .set({
        uploadId: input.uploadId,
        status: "uploading",
        errorCode: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chapterImportItems.id, input.itemId),
          eq(chapterImportItems.status, "pending"),
        ),
      )
      .returning({ id: chapterImportItems.id });
    return Boolean(item);
  }

  async failReservation(input: { batchId: string; errorCode: string }) {
    await this.db
      .update(chapterImportItems)
      .set({ status: "failed", errorCode: input.errorCode })
      .where(
        and(
          eq(chapterImportItems.batchId, input.batchId),
          eq(chapterImportItems.status, "pending"),
        ),
      );
  }

  async updateResolution(input: {
    itemId: string;
    chapterId?: string;
    resolution: NonNullable<ImportItemProjection["resolution"]>;
    errorCode?: string | null;
    status?: ImportItemProjection["status"];
  }) {
    const [item] = await this.db
      .update(chapterImportItems)
      .set({
        ...(input.chapterId ? { chapterId: input.chapterId } : {}),
        targetResolution: input.resolution,
        ...(input.errorCode !== undefined
          ? { errorCode: input.errorCode }
          : {}),
        ...(input.status ? { status: input.status } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chapterImportItems.id, input.itemId),
          eq(chapterImportItems.status, "pending"),
        ),
      )
      .returning({ id: chapterImportItems.id });
    return Boolean(item);
  }

  async failItem(input: { itemId: string; errorCode: string }): Promise<void> {
    await this.db
      .update(chapterImportItems)
      .set({
        status: "failed",
        errorCode: input.errorCode,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(chapterImportItems.id, input.itemId),
          eq(chapterImportItems.status, "pending"),
        ),
      );
  }

  async findTarget(seriesId: string, chapterNumber: number) {
    const canonical = ChapterNumber.parse(chapterNumber).toNumber();
    const [row] = await this.db
      .select({
        chapterId: chapters.id,
        status: chapters.status,
        hasActiveUpload: sql<boolean>`exists (
          select 1 from ${uploads}
          where ${uploads.chapterId} = ${chapters.id}
            and ${uploads.status} in ('pending', 'verifying', 'aborting')
        )`,
        hasUpload: sql<boolean>`exists (
          select 1 from ${uploads}
          where ${uploads.chapterId} = ${chapters.id}
        )`,
        hasMedia: sql<boolean>`exists (
          select 1 from ${images}
          where ${images.chapterId} = ${chapters.id}
        )`,
      })
      .from(chapters)
      .where(
        and(
          eq(chapters.seriesId, seriesId),
          eq(chapters.chapterNumber, canonical),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async find(batchId: string) {
    const [batch] = await this.db
      .select({
        id: chapterImportBatches.id,
        seriesId: chapterImportBatches.seriesId,
      })
      .from(chapterImportBatches)
      .where(eq(chapterImportBatches.id, batchId))
      .limit(1);
    if (!batch) return null;
    const rows = await this.db
      .select({
        id: chapterImportItems.id,
        clientId: chapterImportItems.clientId,
        chapterNumber: chapterImportItems.chapterNumber,
        filename: chapterImportItems.filename,
        chapterId: chapterImportItems.chapterId,
        uploadId: chapterImportItems.uploadId,
        status: chapterImportItems.status,
        errorCode: chapterImportItems.errorCode,
        resolution: chapterImportItems.targetResolution,
        createdAt: chapterImportItems.createdAt,
        updatedAt: chapterImportItems.updatedAt,
      })
      .from(chapterImportItems)
      .where(eq(chapterImportItems.batchId, batchId))
      .orderBy(
        asc(chapterImportItems.createdAt),
        asc(chapterImportItems.chapterNumber),
      );
    const chapterIds = rows.flatMap((row) =>
      row.chapterId ? [row.chapterId] : [],
    );
    const imageRows = chapterIds.length
      ? await this.db
          .select({ chapterId: images.chapterId, warnings: images.warnings })
          .from(images)
          .where(inArray(images.chapterId, chapterIds))
      : [];
    return {
      ...batch,
      items: rows.map(
        (row): ImportItemProjection => ({
          itemId: row.id,
          clientId: row.clientId,
          chapterNumber: ChapterNumber.parse(row.chapterNumber).toNumber(),
          filename: row.filename,
          chapterId: row.chapterId,
          uploadId: row.uploadId,
          status: row.status,
          errorCode: row.errorCode,
          resolution: row.resolution,
          warnings: imageRows
            .filter((image) => image.chapterId === row.chapterId)
            .flatMap((image) => image.warnings),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        }),
      ),
    };
  }

  async claimRetry(input: {
    seriesId: string;
    batchId: string;
    itemId: string;
  }): ReturnType<ImportBatchRepositoryPort["claimRetry"]> {
    return this.db.transaction(async (tx) => {
      const [item] = await tx
        .select({
          id: chapterImportItems.id,
          clientId: chapterImportItems.clientId,
          chapterId: chapterImportItems.chapterId,
          chapterNumber: chapterImportItems.chapterNumber,
          filename: chapterImportItems.filename,
          status: chapterImportItems.status,
          errorCode: chapterImportItems.errorCode,
        })
        .from(chapterImportItems)
        .innerJoin(
          chapterImportBatches,
          eq(chapterImportBatches.id, chapterImportItems.batchId),
        )
        .where(
          and(
            eq(chapterImportBatches.id, input.batchId),
            eq(chapterImportBatches.seriesId, input.seriesId),
            eq(chapterImportItems.id, input.itemId),
          ),
        )
        .limit(1)
        .for("update");
      if (!item) return { outcome: "not-found" as const };
      if (item.status !== "failed") return { outcome: "conflict" as const };
      const [claimed] = await tx
        .update(chapterImportItems)
        .set({ uploadId: null, status: "pending", updatedAt: new Date() })
        .where(
          and(
            eq(chapterImportItems.id, item.id),
            eq(chapterImportItems.status, "failed"),
          ),
        )
        .returning({ id: chapterImportItems.id });
      return claimed
        ? {
            outcome: "claimed" as const,
            item: {
              id: item.id,
              clientId: item.clientId,
              chapterId: item.chapterId,
              chapterNumber: ChapterNumber.parse(item.chapterNumber).toNumber(),
              filename: item.filename,
            },
          }
        : { outcome: "conflict" as const };
    });
  }
}
