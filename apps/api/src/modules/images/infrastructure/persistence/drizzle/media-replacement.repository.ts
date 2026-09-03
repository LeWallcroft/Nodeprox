import { and, eq, sql } from "drizzle-orm";
import { sanitizeAuditMetadata } from "@nodeprox/types";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapters,
  images,
  imageVersions,
  mediaEffectOutbox,
  series,
} from "../../../../../../../../database/schema/index.js";
import type {
  MediaReplacementRepositoryPort,
  MediaReplacementTransactionPort,
} from "../../../application/media-replacement.ports.js";

export class DrizzleMediaReplacementRepository
  implements MediaReplacementRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async findChapterId(imageId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ chapterId: images.chapterId })
      .from(images)
      .where(eq(images.id, imageId))
      .limit(1);
    return row?.chapterId ?? null;
  }

  async withLockedImage<T>(
    imageId: string,
    work: (transaction: MediaReplacementTransactionPort) => Promise<T>,
  ): Promise<T | null> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select id from images where id = ${imageId} for update`,
      );
      const [row] = await tx
        .select({
          id: images.id,
          chapterId: images.chapterId,
          seriesSlug: series.slug,
          chapterPublicKey: chapters.publicKey,
          currentId: imageVersions.id,
          currentVersion: imageVersions.version,
          physicalFilename: imageVersions.physicalFilename,
          storageKey: imageVersions.storageKey,
          extension: imageVersions.extension,
          contentType: imageVersions.contentType,
          sizeBytes: imageVersions.sizeBytes,
          checksum: imageVersions.checksum,
        })
        .from(images)
        .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
        .innerJoin(chapters, eq(chapters.id, images.chapterId))
        .innerJoin(series, eq(series.id, chapters.seriesId))
        .where(eq(images.id, imageId))
        .limit(1);
      if (!row) return null;
      const [initial] = await tx
        .select({ physicalFilename: imageVersions.physicalFilename })
        .from(imageVersions)
        .where(
          and(eq(imageVersions.imageId, imageId), eq(imageVersions.version, 1)),
        )
        .limit(1);
      if (!initial) throw new Error("media-initial-version-missing");

      return work({
        image: {
          id: row.id,
          chapterId: row.chapterId,
          seriesSlug: row.seriesSlug,
          chapterPublicKey: row.chapterPublicKey,
          logicalFilename: initial.physicalFilename,
          current: {
            id: row.currentId,
            version: row.currentVersion,
            physicalFilename: row.physicalFilename,
            storageKey: row.storageKey,
            extension: row.extension,
            contentType: row.contentType,
            sizeBytes: row.sizeBytes,
            checksum: row.checksum,
          },
        },
        cutover: async (input) => {
          const [version] = await tx
            .insert(imageVersions)
            .values({ imageId, ...input.next })
            .returning({ id: imageVersions.id });
          if (!version) throw new Error("media-version-insert-failed");

          const [updated] = await tx
            .update(images)
            .set({
              currentVersionId: version.id,
              filename: input.next.physicalFilename,
              storageKey: input.next.storageKey,
              extension: input.next.extension,
              contentType: input.next.contentType,
              sizeBytes: input.next.sizeBytes,
              checksum: input.next.checksum,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(images.id, imageId),
                eq(images.currentVersionId, row.currentId),
              ),
            )
            .returning({ id: images.id });
          if (!updated) throw new Error("media-version-cutover-conflict");

          await tx.insert(mediaEffectOutbox).values([
            {
              replacementOperationId: input.operationId,
              effectType: "cdn_purge",
              imageId,
              target: input.oldPublicUrl,
            },
            {
              replacementOperationId: input.operationId,
              effectType: "storage_delete",
              imageId,
              target: row.storageKey,
            },
          ]);
          await tx.insert(auditLogs).values({
            actorId: input.actorId,
            action: "image.replaced",
            resourceType: "image",
            resourceId: imageId,
            result: "success",
            ...(input.requestId ? { requestId: input.requestId } : {}),
            metadata: sanitizeAuditMetadata({
              previousVersion: row.currentVersion,
              currentVersion: input.next.version,
            }),
          });
          return { versionId: version.id };
        },
      });
    });
  }

  async enqueueOrphanCleanup(input: {
    operationId: string;
    imageId: string;
    storageKey: string;
  }): Promise<void> {
    await this.db
      .insert(mediaEffectOutbox)
      .values({
        replacementOperationId: input.operationId,
        effectType: "storage_delete",
        imageId: input.imageId,
        target: input.storageKey,
      })
      .onConflictDoNothing();
  }
}
