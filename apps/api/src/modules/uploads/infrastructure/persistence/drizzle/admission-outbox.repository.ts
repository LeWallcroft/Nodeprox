import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { uploadValidationOutbox } from "../../../../../../../../database/schema/index.js";

export class DrizzleAdmissionOutboxRepository {
  constructor(private readonly db: NodeProxDatabase) {}

  async findPending(limit: number) {
    return this.db
      .select({
        outboxId: uploadValidationOutbox.id,
        uploadId: uploadValidationOutbox.uploadId,
        replacementId: uploadValidationOutbox.replacementId,
        originRequestId: uploadValidationOutbox.originRequestId,
      })
      .from(uploadValidationOutbox)
      .where(
        and(
          eq(uploadValidationOutbox.status, "pending"),
          lte(uploadValidationOutbox.availableAt, new Date()),
        ),
      )
      .orderBy(asc(uploadValidationOutbox.createdAt))
      .limit(limit);
  }

  async markEnqueued(outboxId: string): Promise<void> {
    await this.db
      .update(uploadValidationOutbox)
      .set({
        status: "enqueued",
        attempts: sql`${uploadValidationOutbox.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(uploadValidationOutbox.id, outboxId),
          eq(uploadValidationOutbox.status, "pending"),
        ),
      );
  }
}
