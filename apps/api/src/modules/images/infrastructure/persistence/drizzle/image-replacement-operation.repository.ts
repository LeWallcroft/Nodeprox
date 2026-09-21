import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  chapterReplacementOperations,
  domainEventOutbox,
  imageReplacementOperations,
} from "../../../../../../../../database/schema/index.js";
import type {
  ImageReplacementOperation,
  ImageReplacementOperationRepository,
} from "../../../application/image-replacement-operation.repository.js";

export class DrizzleImageReplacementOperationRepository
  implements ImageReplacementOperationRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async create(
    input: Omit<
      ImageReplacementOperation,
      | "createdAt"
      | "updatedAt"
      | "completedAt"
      | "resultImageVersionId"
      | "lastErrorCode"
    >,
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from chapters where id = ${input.chapterId} for update`,
        );
        const [chapterReplacement] = await tx
          .select({ id: chapterReplacementOperations.id })
          .from(chapterReplacementOperations)
          .where(
            and(
              eq(chapterReplacementOperations.chapterId, input.chapterId),
              inArray(chapterReplacementOperations.status, [
                "pending_upload",
                "uploaded",
                "processing",
                "ready",
                "completing",
              ]),
            ),
          )
          .limit(1);
        if (chapterReplacement) return null;
        const [activeImageReplacement] = await tx
          .select({ id: imageReplacementOperations.id })
          .from(imageReplacementOperations)
          .where(
            and(
              eq(imageReplacementOperations.imageId, input.imageId),
              inArray(imageReplacementOperations.status, [
                "pending_upload",
                "uploaded",
                "completing",
              ]),
            ),
          )
          .limit(1);
        if (activeImageReplacement) return null;
        const [row] = await tx
          .insert(imageReplacementOperations)
          .values(input)
          .returning();
        if (!row) throw new Error("image-replacement-operation-create-failed");
        return map(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async findById(id: string) {
    const [row] = await this.db
      .select()
      .from(imageReplacementOperations)
      .where(eq(imageReplacementOperations.id, id))
      .limit(1);
    return row ? map(row) : null;
  }

  async markUploaded(id: string, updatedAt: Date) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(imageReplacementOperations)
        .set({ status: "uploaded", updatedAt })
        .where(
          and(
            eq(imageReplacementOperations.id, id),
            eq(imageReplacementOperations.status, "pending_upload"),
          ),
        )
        .returning();
      if (row)
        await tx.insert(domainEventOutbox).values({
          eventType: "image.replacement.ready",
          aggregateType: "image_replacement",
          aggregateId: row.id,
          actorUserId: row.requestedByUserId,
          payload: {
            targetUserId: row.requestedByUserId,
            chapterId: row.chapterId,
            imageId: row.imageId,
          },
          occurredAt: updatedAt,
        });
      return row ? map(row) : this.findById(id);
    });
  }

  async tryBeginCompletion(id: string, updatedAt: Date) {
    const [row] = await this.db
      .update(imageReplacementOperations)
      .set({ status: "completing", updatedAt })
      .where(
        and(
          eq(imageReplacementOperations.id, id),
          inArray(imageReplacementOperations.status, [
            "pending_upload",
            "uploaded",
          ]),
        ),
      )
      .returning();
    if (row) return { acquired: true, operation: map(row) };
    return { acquired: false, operation: await this.findById(id) };
  }

  async markCompleted(input: {
    operationId: string;
    resultImageVersionId: string;
    completedAt: Date;
  }) {
    const [row] = await this.db
      .update(imageReplacementOperations)
      .set({
        status: "completed",
        resultImageVersionId: input.resultImageVersionId,
        completedAt: input.completedAt,
        updatedAt: input.completedAt,
      })
      .where(
        and(
          eq(imageReplacementOperations.id, input.operationId),
          inArray(imageReplacementOperations.status, [
            "pending_upload",
            "uploaded",
            "completing",
          ]),
        ),
      )
      .returning();
    if (row) return map(row);
    const current = await this.findById(input.operationId);
    if (
      current?.status === "completed" &&
      current.resultImageVersionId === input.resultImageVersionId
    )
      return current;
    if (current?.status === "completed")
      throw new Error("image-replacement-operation-result-conflict");
    return current;
  }

  async markFailed(input: {
    operationId: string;
    errorCode: string;
    updatedAt: Date;
  }) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(imageReplacementOperations)
        .set({
          status: "failed",
          lastErrorCode: input.errorCode,
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(imageReplacementOperations.id, input.operationId),
            ne(imageReplacementOperations.status, "completed"),
            ne(imageReplacementOperations.status, "failed"),
          ),
        )
        .returning();
      if (row)
        await tx.insert(domainEventOutbox).values({
          eventType: "upload.failed",
          aggregateType: "image_replacement",
          aggregateId: row.id,
          actorUserId: row.requestedByUserId,
          payload: {
            targetUserId: row.requestedByUserId,
            chapterId: row.chapterId,
            imageId: row.imageId,
            operationKind: "image_replacement",
            errorCode: input.errorCode,
          },
          occurredAt: input.updatedAt,
        });
      return row ? map(row) : this.findById(input.operationId);
    });
  }
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "23505") return true;
  return "cause" in error && isUniqueViolation(error.cause);
}

function map(
  row: typeof imageReplacementOperations.$inferSelect,
): ImageReplacementOperation {
  return row;
}
