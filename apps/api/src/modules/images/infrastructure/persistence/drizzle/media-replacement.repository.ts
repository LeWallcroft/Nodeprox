import { sanitizeAuditMetadata } from "@nodeprox/types";
import { aliasedTable, and, eq, isNull, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  chapters,
  domainEventOutbox,
  imageReplacementOperations,
  images,
  imageVersions,
  mediaEffectOutbox,
  series,
} from "../../../../../../../../database/schema/index.js";
import type {
  MediaReplacementRepositoryPort,
  MediaReplacementTransactionPort,
} from "../../../application/media-replacement.ports.js";
import { acquireChapterMediaLock } from "./chapter-media-lock.js";

export class DrizzleMediaReplacementRepository
  implements MediaReplacementRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async findCandidateContext(imageId: string) {
    const initialVersion = aliasedTable(imageVersions, "initial_image_version");
    const [row] = await this.db
      .select({
        chapterId: images.chapterId,
        currentStorageKey: images.storageKey,
        currentContentType: images.contentType,
        currentVersion: imageVersions.version,
        logicalFilename: initialVersion.physicalFilename,
      })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .innerJoin(
        initialVersion,
        and(
          eq(initialVersion.imageId, images.id),
          eq(initialVersion.version, 1),
        ),
      )
      .where(and(eq(images.id, imageId), isNull(images.retiredAt)))
      .limit(1);
    return row ?? null;
  }

  async withLockedImage<T>(
    imageId: string,
    work: (transaction: MediaReplacementTransactionPort) => Promise<T>,
  ): Promise<T | null> {
    const [scope] = await this.db
      .select({ chapterId: images.chapterId })
      .from(images)
      .where(and(eq(images.id, imageId), isNull(images.retiredAt)))
      .limit(1);
    if (!scope) return null;
    return this.db.transaction(async (tx) => {
      await acquireChapterMediaLock(tx, scope.chapterId);
      await tx.execute(
        sql`select id from chapters where id = ${scope.chapterId} for update`,
      );
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
          storageProfileId: imageVersions.storageProfileId,
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
        .where(and(eq(images.id, imageId), isNull(images.retiredAt)))
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
            storageProfileId: row.storageProfileId,
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
              storageProfileId: input.next.storageProfileId,
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
              storageProfileId: row.storageProfileId,
              effectType: "cdn_purge",
              imageId,
              target: input.oldPublicUrl,
            },
            {
              replacementOperationId: input.operationId,
              storageProfileId: row.storageProfileId,
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
        completeReplacementOperation: async (input) => {
          const [completed] = await tx
            .update(imageReplacementOperations)
            .set({
              status: "completed",
              resultImageVersionId: input.resultImageVersionId,
              completedAt: input.completedAt,
              updatedAt: input.completedAt,
              lastErrorCode: null,
            })
            .where(
              and(
                eq(imageReplacementOperations.id, input.operationId),
                eq(imageReplacementOperations.imageId, input.imageId),
                eq(imageReplacementOperations.status, "completing"),
                sql`${imageReplacementOperations.resultImageVersionId} is null`,
              ),
            )
            .returning({ id: imageReplacementOperations.id });
          if (completed) {
            await tx.insert(domainEventOutbox).values({
              eventType: "upload.completed",
              aggregateType: "image_replacement",
              aggregateId: input.operationId,
              actorUserId: input.actorId,
              payload: {
                targetUserId: input.actorId,
                imageId: input.imageId,
                chapterId: row.chapterId,
                operationKind: "image_replacement",
              },
              occurredAt: input.completedAt,
            });
            return;
          }

          const [current] = await tx
            .select({
              status: imageReplacementOperations.status,
              imageId: imageReplacementOperations.imageId,
              resultImageVersionId:
                imageReplacementOperations.resultImageVersionId,
            })
            .from(imageReplacementOperations)
            .where(eq(imageReplacementOperations.id, input.operationId))
            .limit(1);
          if (
            current?.status === "completed" &&
            current.imageId === input.imageId &&
            current.resultImageVersionId === input.resultImageVersionId
          )
            return;
          if (current?.status === "completed")
            throw new Error("image-replacement-operation-result-conflict");
          throw new Error("image-replacement-operation-completion-conflict");
        },
      });
    });
  }

  async enqueueOrphanCleanup(input: {
    operationId: string;
    imageId: string;
    storageProfileId: string;
    storageKey: string;
  }): Promise<void> {
    await this.db
      .insert(mediaEffectOutbox)
      .values({
        replacementOperationId: input.operationId,
        storageProfileId: input.storageProfileId,
        effectType: "storage_delete",
        imageId: input.imageId,
        target: input.storageKey,
      })
      .onConflictDoNothing();
  }
}
