import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import {
  chapterReplacementItems,
  chapterReplacementOperations,
  images,
  imageVersions,
  storageCleanupOutbox,
} from "../../../../../../../database/schema/index.js";
import type {
  StorageCleanupEffect,
  StorageCleanupRepositoryPort,
} from "../../../application/ports.js";

export class DrizzleStorageCleanupRepository
  implements StorageCleanupRepositoryPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async claimPending(limit: number): Promise<readonly StorageCleanupEffect[]> {
    const safeLimit = Math.max(1, Math.min(limit, 20));
    const rows = await this.db.execute(sql<StorageCleanupEffect>`
      with candidates as (
        select id
        from storage_cleanup_outbox
        where status in ('pending', 'processing')
          and available_at <= now()
        order by created_at asc
        for update skip locked
        limit ${safeLimit}
      )
      update storage_cleanup_outbox as cleanup
      set status = 'processing',
          attempts = cleanup.attempts + 1,
          available_at = now() + interval '5 minutes',
          updated_at = now()
      from candidates
      where cleanup.id = candidates.id
      returning cleanup.id,
                cleanup.replacement_id as "replacementId",
                cleanup.storage_key as "storageKey",
                cleanup.reason,
                cleanup.attempts
    `);
    return [...rows].map((row) => ({
      id: String(row.id),
      replacementId: String(row.replacementId),
      storageKey: String(row.storageKey),
      reason: row.reason as StorageCleanupEffect["reason"],
      attempts: Number(row.attempts),
    }));
  }

  async isSafeToDelete(effect: StorageCleanupEffect): Promise<boolean> {
    if (effect.reason === "replacement_source_zip") {
      const [operation] = await this.db
        .select({
          sourceStorageKey: chapterReplacementOperations.candidateZipStorageKey,
          status: chapterReplacementOperations.status,
        })
        .from(chapterReplacementOperations)
        .where(eq(chapterReplacementOperations.id, effect.replacementId))
        .limit(1);
      return Boolean(
        operation &&
          operation.sourceStorageKey === effect.storageKey &&
          ["ready", "completing", "completed", "failed"].includes(
            operation.status,
          ),
      );
    }

    const [candidate] = await this.db
      .select({ status: chapterReplacementOperations.status })
      .from(chapterReplacementItems)
      .innerJoin(
        chapterReplacementOperations,
        eq(
          chapterReplacementOperations.id,
          chapterReplacementItems.operationId,
        ),
      )
      .where(
        and(
          eq(chapterReplacementItems.operationId, effect.replacementId),
          eq(chapterReplacementItems.candidateStorageKey, effect.storageKey),
        ),
      )
      .limit(1);
    if (candidate?.status !== "failed") return false;
    const [canonical] = await this.db
      .select({ id: images.id })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(
        and(
          eq(imageVersions.storageKey, effect.storageKey),
          isNull(images.retiredAt),
        ),
      )
      .limit(1);
    return !canonical;
  }

  async markCompleted(effectId: string): Promise<void> {
    await this.db
      .update(storageCleanupOutbox)
      .set({
        status: "completed",
        processedAt: new Date(),
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(storageCleanupOutbox.id, effectId));
  }

  async markRetry(
    effectId: string,
    availableAt: Date,
    code: string,
  ): Promise<void> {
    await this.db
      .update(storageCleanupOutbox)
      .set({
        status: "pending",
        availableAt,
        lastErrorCode: code,
        updatedAt: new Date(),
      })
      .where(eq(storageCleanupOutbox.id, effectId));
  }

  async markFailed(effectId: string, code: string): Promise<void> {
    await this.db
      .update(storageCleanupOutbox)
      .set({ status: "failed", lastErrorCode: code, updatedAt: new Date() })
      .where(eq(storageCleanupOutbox.id, effectId));
  }
}
