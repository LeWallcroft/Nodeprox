import { and, eq, inArray, ne } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { imageReplacementOperations } from "../../../../../../../../database/schema/index.js";
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
    const [row] = await this.db
      .insert(imageReplacementOperations)
      .values(input)
      .returning();
    if (!row) throw new Error("image-replacement-operation-create-failed");
    return map(row);
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
    const [row] = await this.db
      .update(imageReplacementOperations)
      .set({ status: "uploaded", updatedAt })
      .where(
        and(
          eq(imageReplacementOperations.id, id),
          eq(imageReplacementOperations.status, "pending_upload"),
        ),
      )
      .returning();
    return row ? map(row) : this.findById(id);
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
    const [row] = await this.db
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
        ),
      )
      .returning();
    return row ? map(row) : this.findById(input.operationId);
  }
}

function map(
  row: typeof imageReplacementOperations.$inferSelect,
): ImageReplacementOperation {
  return row;
}
