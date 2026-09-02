import type { NodeProxDatabase } from "../../../../database/client.js";
import { auditLogs } from "../../../../database/schema/index.js";
import { sanitizeAuditMetadata } from "../modules/authorization/infrastructure/audit/audit-metadata.js";

export interface OperationAuditWriter {
  append(input: {
    actorId?: string;
    requestId: string;
    operation: {
      action: string;
      resourceType?: string;
      resourceId?: string;
      seriesId?: string;
      chapterId?: string;
    };
    result: "rejected" | "failed";
    reasonCode: string;
  }): Promise<void>;
}

/** Infrastructure adapter used only by the explicitly wired error boundary. */
export class DrizzleOperationAuditWriter implements OperationAuditWriter {
  constructor(private readonly db: NodeProxDatabase) {}

  async append(input: Parameters<OperationAuditWriter["append"]>[0]) {
    await this.db.insert(auditLogs).values({
      ...(input.actorId ? { actorId: input.actorId } : {}),
      action: input.operation.action,
      resourceType: input.operation.resourceType ?? "operation",
      ...(input.operation.resourceId
        ? { resourceId: input.operation.resourceId }
        : {}),
      result: input.result,
      reasonCode: input.reasonCode,
      requestId: input.requestId,
      metadata: sanitizeAuditMetadata({
        ...(input.operation.seriesId
          ? { seriesId: input.operation.seriesId }
          : {}),
        ...(input.operation.chapterId
          ? { chapterId: input.operation.chapterId }
          : {}),
      }),
    });
  }
}
