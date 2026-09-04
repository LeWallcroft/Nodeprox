import { randomUUID } from "node:crypto";
import { sanitizeAuditMetadata } from "@nodeprox/types";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapterReplacementItems,
  chapterReplacementOperations,
  chapters,
  images,
  imageVersions,
  mediaEffectOutbox,
  series,
} from "../../../../../../../../database/schema/index.js";
import { MediaStorageKey } from "../../../../images/domain/media-storage-key.js";
import { MediaVersion } from "../../../../images/domain/media-version.js";
import { PublicMediaUrl } from "../../../../images/domain/public-media-url.js";
import { acquireChapterMediaLock } from "../../../../images/infrastructure/persistence/drizzle/chapter-media-lock.js";
import type {
  ActivateChapterReplacementOutcome,
  ChapterMediaReplacementRepository,
} from "../../../application/ports/chapter-media-replacement.repository.js";
import type { ChapterReplacementResult } from "../../../domain/chapter-replacement-result.js";

export class DrizzleChapterMediaReplacementRepository
  implements ChapterMediaReplacementRepository
{
  constructor(
    private readonly db: NodeProxDatabase,
    private readonly publicMediaOrigin: string,
  ) {}

  async activate(
    input: Parameters<ChapterMediaReplacementRepository["activate"]>[0],
  ): Promise<ActivateChapterReplacementOutcome> {
    return this.db.transaction(async (tx) => {
      await acquireChapterMediaLock(tx, input.chapterId);
      await tx.execute(
        sql`select id from chapters where id = ${input.chapterId} for update`,
      );
      const [chapter] = await tx
        .select({
          id: chapters.id,
          publicKey: chapters.publicKey,
          seriesSlug: series.slug,
        })
        .from(chapters)
        .innerJoin(series, eq(series.id, chapters.seriesId))
        .where(eq(chapters.id, input.chapterId))
        .limit(1);
      if (!chapter) return { outcome: "not-found" as const };

      const activeImages = await tx
        .select({
          id: images.id,
          sortOrder: images.sortOrder,
          currentVersionId: imageVersions.id,
          currentVersion: imageVersions.version,
          currentPhysicalFilename: imageVersions.physicalFilename,
          currentStorageKey: imageVersions.storageKey,
          currentContentType: imageVersions.contentType,
        })
        .from(images)
        .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
        .where(
          and(eq(images.chapterId, input.chapterId), isNull(images.retiredAt)),
        )
        .orderBy(asc(images.sortOrder), asc(images.id))
        .for("update");

      const [operation] = await tx
        .select()
        .from(chapterReplacementOperations)
        .where(
          and(
            eq(chapterReplacementOperations.id, input.replacementId),
            eq(chapterReplacementOperations.chapterId, input.chapterId),
          ),
        )
        .limit(1)
        .for("update");
      if (!operation) return { outcome: "not-found" as const };
      if (operation.status === "completed") {
        const result = completedResult(operation);
        return result
          ? { outcome: "completed" as const, result }
          : { outcome: "invalid" as const };
      }
      if (operation.status === "completing")
        return { outcome: "in-progress" as const };
      if (operation.status !== "ready")
        return { outcome: "not-ready" as const };

      const items = await tx
        .select()
        .from(chapterReplacementItems)
        .where(eq(chapterReplacementItems.operationId, operation.id))
        .orderBy(
          asc(chapterReplacementItems.sortOrder),
          asc(chapterReplacementItems.id),
        )
        .for("update");
      if (!validManifest(items, chapter.seriesSlug, chapter.publicKey))
        return { outcome: "invalid" as const };

      const [claimed] = await tx
        .update(chapterReplacementOperations)
        .set({ status: "completing", updatedAt: new Date() })
        .where(
          and(
            eq(chapterReplacementOperations.id, operation.id),
            eq(chapterReplacementOperations.status, "ready"),
          ),
        )
        .returning({ id: chapterReplacementOperations.id });
      if (!claimed) return { outcome: "in-progress" as const };

      const completedAt = new Date();
      const oldCount = activeImages.length;
      const newCount = items.length;
      const retainedCount = Math.min(oldCount, newCount);
      const createdCount = Math.max(newCount - oldCount, 0);
      const retiredCount = Math.max(oldCount - newCount, 0);

      // Release active slot numbers before assigning the complete new order.
      for (const [index, image] of activeImages.entries())
        await tx
          .update(images)
          .set({ sortOrder: -(index + 1) })
          .where(and(eq(images.id, image.id), isNull(images.retiredAt)));

      for (const [index, item] of items.entries()) {
        const retained = activeImages[index];
        const parsed = MediaStorageKey.parseExisting(item.candidateStorageKey);
        const imageId = retained?.id ?? randomUUID();
        const versionId = randomUUID();
        const version = retained
          ? MediaVersion.parse(retained.currentVersion).next().toNumber()
          : 1;

        if (!retained) {
          await tx.insert(images).values({
            id: imageId,
            chapterId: chapter.id,
            filename: item.physicalFilename,
            storageKey: item.candidateStorageKey,
            extension: parsed.extension,
            contentType: item.contentType,
            sizeBytes: item.sizeBytes,
            sortOrder: item.sortOrder,
            checksum: item.checksum,
            warnings: [],
            currentVersionId: versionId,
          });
        }

        await tx.insert(imageVersions).values({
          id: versionId,
          imageId,
          version,
          physicalFilename: item.physicalFilename,
          storageKey: item.candidateStorageKey,
          extension: parsed.extension,
          contentType: item.contentType,
          sizeBytes: item.sizeBytes,
          checksum: item.checksum,
        });

        if (retained) {
          const [updated] = await tx
            .update(images)
            .set({
              filename: item.physicalFilename,
              storageKey: item.candidateStorageKey,
              extension: parsed.extension,
              contentType: item.contentType,
              sizeBytes: item.sizeBytes,
              sortOrder: item.sortOrder,
              checksum: item.checksum,
              warnings: [],
              currentVersionId: versionId,
              updatedAt: completedAt,
            })
            .where(
              and(
                eq(images.id, retained.id),
                eq(images.currentVersionId, retained.currentVersionId),
                isNull(images.retiredAt),
              ),
            )
            .returning({ id: images.id });
          if (!updated) throw new Error("chapter-media-cutover-conflict");
        }

        const [mapped] = await tx
          .update(chapterReplacementItems)
          .set({
            resultImageId: imageId,
            resultImageVersionId: versionId,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(chapterReplacementItems.id, item.id),
              eq(chapterReplacementItems.operationId, operation.id),
              isNull(chapterReplacementItems.resultImageId),
              isNull(chapterReplacementItems.resultImageVersionId),
            ),
          )
          .returning({ id: chapterReplacementItems.id });
        if (!mapped)
          throw new Error("chapter-replacement-item-result-conflict");
      }

      for (const image of activeImages.slice(newCount)) {
        const [retired] = await tx
          .update(images)
          .set({
            sortOrder: image.sortOrder,
            retiredAt: completedAt,
            retiredByChapterReplacementId: operation.id,
            updatedAt: completedAt,
          })
          .where(and(eq(images.id, image.id), isNull(images.retiredAt)))
          .returning({ id: images.id });
        if (!retired) throw new Error("chapter-media-retirement-conflict");
      }

      const effects = activeImages.flatMap((image) => {
        const oldPublicUrl = PublicMediaUrl.fromImage(this.publicMediaOrigin, {
          seriesPublicSlug: chapter.seriesSlug,
          chapterPublicKey: chapter.publicKey,
          filename: image.currentPhysicalFilename,
          contentType: image.currentContentType,
        }).toString();
        return [
          {
            replacementOperationId: operation.id,
            effectType: "cdn_purge" as const,
            imageId: image.id,
            target: oldPublicUrl,
          },
          {
            replacementOperationId: operation.id,
            effectType: "storage_delete" as const,
            imageId: image.id,
            target: image.currentStorageKey,
          },
        ];
      });
      if (effects.length > 0)
        await tx.insert(mediaEffectOutbox).values(effects);

      await tx.insert(auditLogs).values({
        actorId: input.actorUserId,
        action: "chapter.images.replaced",
        resourceType: "chapter",
        resourceId: chapter.id,
        result: "success",
        ...(input.requestId ? { requestId: input.requestId } : {}),
        metadata: sanitizeAuditMetadata({
          chapterId: chapter.id,
          replacementId: operation.id,
          previousImageCount: oldCount,
          imageCount: newCount,
          retainedImageCount: retainedCount,
          createdImageCount: createdCount,
          retiredImageCount: retiredCount,
        }),
      });

      await tx
        .update(chapters)
        .set({ updatedAt: completedAt })
        .where(eq(chapters.id, chapter.id));

      const [completed] = await tx
        .update(chapterReplacementOperations)
        .set({
          status: "completed",
          previousImageCount: oldCount,
          resultImageCount: newCount,
          retainedImageCount: retainedCount,
          createdImageCount: createdCount,
          retiredImageCount: retiredCount,
          completedAt,
          updatedAt: completedAt,
          lastErrorCode: null,
        })
        .where(
          and(
            eq(chapterReplacementOperations.id, operation.id),
            eq(chapterReplacementOperations.status, "completing"),
          ),
        )
        .returning();
      if (!completed)
        throw new Error("chapter-replacement-completion-conflict");
      const result = completedResult(completed);
      if (!result) throw new Error("chapter-replacement-result-invalid");
      return { outcome: "completed" as const, result };
    });
  }
}

function validManifest(
  items: readonly (typeof chapterReplacementItems.$inferSelect)[],
  seriesSlug: string,
  chapterPublicKey: string,
): boolean {
  if (items.length === 0) return false;
  const orders = new Set<number>();
  for (const item of items) {
    if (
      item.storedAt === null ||
      item.resultImageId !== null ||
      item.resultImageVersionId !== null ||
      !Number.isSafeInteger(item.sortOrder) ||
      item.sortOrder < 0 ||
      orders.has(item.sortOrder) ||
      !Number.isSafeInteger(item.sizeBytes) ||
      item.sizeBytes <= 0 ||
      item.physicalFilename.trim().length === 0 ||
      item.contentType.trim().length === 0 ||
      item.checksum.trim().length === 0
    )
      return false;
    orders.add(item.sortOrder);
    try {
      const candidate = MediaStorageKey.parseExisting(item.candidateStorageKey);
      if (
        candidate.seriesSlug !== seriesSlug ||
        candidate.chapterPublicKey !== chapterPublicKey ||
        candidate.physicalFilename !== item.physicalFilename
      )
        return false;
      PublicMediaUrl.fromImage("https://media.nodeprox.invalid", {
        seriesPublicSlug: seriesSlug,
        chapterPublicKey,
        filename: item.physicalFilename,
        contentType: item.contentType,
      });
    } catch {
      return false;
    }
  }
  return true;
}

function completedResult(
  operation: typeof chapterReplacementOperations.$inferSelect,
): ChapterReplacementResult | null {
  if (
    operation.status !== "completed" ||
    operation.completedAt === null ||
    operation.previousImageCount === null ||
    operation.resultImageCount === null ||
    operation.retainedImageCount === null ||
    operation.createdImageCount === null ||
    operation.retiredImageCount === null
  )
    return null;
  return {
    replacementId: operation.id,
    chapterId: operation.chapterId,
    previousImageCount: operation.previousImageCount,
    imageCount: operation.resultImageCount,
    retainedImageCount: operation.retainedImageCount,
    createdImageCount: operation.createdImageCount,
    retiredImageCount: operation.retiredImageCount,
    completedAt: operation.completedAt,
  };
}
