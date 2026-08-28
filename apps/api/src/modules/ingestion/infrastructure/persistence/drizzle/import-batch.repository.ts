import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterImportBatches,
  chapterImportItems,
  images,
} from "../../../../../../../../database/schema/index.js";
import type {
  ImportBatchRepositoryPort,
  ImportItemProjection,
} from "../../../application/ports.js";

export class DrizzleImportBatchRepository implements ImportBatchRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async create(input: { id: string; seriesId: string; createdBy: string }) {
    await this.db.insert(chapterImportBatches).values(input);
  }

  async addItem(input: {
    batchId: string;
    clientId: string;
    chapterNumber: number;
    filename: string;
    chapterId?: string;
    uploadId?: string;
    status: ImportItemProjection["status"];
    errorCode?: string;
  }) {
    const [item] = await this.db
      .insert(chapterImportItems)
      .values(input)
      .returning({ id: chapterImportItems.id });
    if (!item) throw new Error("import-batch-item-create-failed");
    return item.id;
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
          chapterNumber: row.chapterNumber,
          filename: row.filename,
          chapterId: row.chapterId,
          uploadId: row.uploadId,
          status: row.status,
          errorCode: row.errorCode,
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
  }): Promise<
    | {
        outcome: "claimed";
        item: {
          id: string;
          clientId: string;
          chapterId: string;
          filename: string;
        };
      }
    | { outcome: "not-found" | "conflict" }
  > {
    return this.db.transaction(async (tx) => {
      const [item] = await tx
        .select({
          id: chapterImportItems.id,
          clientId: chapterImportItems.clientId,
          chapterId: chapterImportItems.chapterId,
          filename: chapterImportItems.filename,
          status: chapterImportItems.status,
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
      if (item.status !== "failed" || !item.chapterId)
        return { outcome: "conflict" as const };
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
              filename: item.filename,
            },
          }
        : { outcome: "conflict" as const };
    });
  }

  async attachRetryUpload(input: {
    itemId: string;
    uploadId: string;
  }): Promise<boolean> {
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

  async failRetry(input: { itemId: string; errorCode: string }): Promise<void> {
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
}
