import { and, eq, isNull, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../database/client.js";
import {
  images,
  imageVersions,
  mediaEffectOutbox,
} from "../../../../../../../database/schema/index.js";
import type {
  ClaimedMediaEffect,
  MediaEffectRepositoryPort,
} from "../../../application/ports.js";

export class DrizzleMediaEffectRepository implements MediaEffectRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async claimPending(limit: number): Promise<readonly ClaimedMediaEffect[]> {
    const safeLimit = Math.max(1, Math.min(limit, 20));
    const rows = await this.db.execute(sql<ClaimedMediaEffect>`
      with candidates as (
        select id
        from media_effect_outbox
        where status in ('pending', 'processing')
          and available_at <= now()
        order by created_at asc
        for update skip locked
        limit ${safeLimit}
      )
      update media_effect_outbox as effects
      set status = 'processing',
          attempts = effects.attempts + 1,
          available_at = now() + interval '5 minutes',
          updated_at = now()
      from candidates
      where effects.id = candidates.id
      returning effects.id,
                effects.effect_type as "effectType",
                effects.image_id as "imageId",
                effects.target,
                effects.storage_profile_id as "storageProfileId",
                effects.attempts
    `);
    return [...rows].map((row) => ({
      id: String(row.id),
      effectType: row.effectType as ClaimedMediaEffect["effectType"],
      imageId: String(row.imageId),
      target: String(row.target),
      storageProfileId: String(row.storageProfileId),
      attempts: Number(row.attempts),
    }));
  }

  async isCurrentStorageKey(
    _imageId: string,
    storageProfileId: string,
    storageKey: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ storageKey: imageVersions.storageKey })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(
        and(
          eq(imageVersions.storageKey, storageKey),
          eq(imageVersions.storageProfileId, storageProfileId),
          isNull(images.retiredAt),
        ),
      )
      .limit(1);
    return row?.storageKey === storageKey;
  }

  async markCompleted(effectId: string): Promise<void> {
    await this.db
      .update(mediaEffectOutbox)
      .set({
        status: "completed",
        completedAt: new Date(),
        lastErrorCode: null,
        updatedAt: new Date(),
      })
      .where(eq(mediaEffectOutbox.id, effectId));
  }

  async markRetry(
    effectId: string,
    availableAt: Date,
    code: string,
  ): Promise<void> {
    await this.db
      .update(mediaEffectOutbox)
      .set({
        status: "pending",
        availableAt,
        lastErrorCode: code,
        updatedAt: new Date(),
      })
      .where(eq(mediaEffectOutbox.id, effectId));
  }

  async markFailed(effectId: string, code: string): Promise<void> {
    await this.db
      .update(mediaEffectOutbox)
      .set({ status: "failed", lastErrorCode: code, updatedAt: new Date() })
      .where(eq(mediaEffectOutbox.id, effectId));
  }
}
