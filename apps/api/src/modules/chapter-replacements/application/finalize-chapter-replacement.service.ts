import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import type { ChapterImageAuthorizationPort } from "../../images/application/ports.js";
import type { ChapterReplacementResult } from "../domain/chapter-replacement-result.js";
import type { ChapterReplacementStatus } from "../domain/chapter-replacement-status.js";
import {
  type ChapterMediaActivationService,
  ChapterReplacementActivationInProgressError,
} from "./chapter-media-activation.service.js";
import type { ChapterReplacementOperationRepository } from "./ports/chapter-replacement-operation.repository.js";

export class ChapterReplacementNotFoundError extends Error {}
export class ChapterReplacementDeniedError extends Error {}
export class ChapterReplacementInvalidStateError extends Error {}
export class ChapterReplacementInvariantError extends Error {}

export type ChapterReplacementProjection = {
  replacementId: string;
  chapterId: string;
  status: ChapterReplacementStatus;
  errorCode?: string;
  result?: ChapterReplacementResult;
};

export class FinalizeChapterReplacementService {
  constructor(
    private readonly operations: ChapterReplacementOperationRepository,
    private readonly activation: ChapterMediaActivationService,
    private readonly authorization: ChapterImageAuthorizationPort,
  ) {}

  async execute(input: {
    replacementId: string;
    chapterId: string;
    context: AuthorizationContext;
    requestId?: string;
  }): Promise<ChapterReplacementProjection> {
    const operation = await this.loadAndAuthorize(input);
    if (operation.status === "completed")
      return this.completedProjection(operation.id, operation.chapterId);
    if (operation.status !== "ready") return projectState(operation);

    try {
      const result = await this.activation.execute(input);
      return {
        replacementId: result.replacementId,
        chapterId: result.chapterId,
        status: "completed",
        result,
      };
    } catch (error) {
      if (!(error instanceof ChapterReplacementActivationInProgressError))
        throw error;
      const converged = await this.operations.findByIdForChapter(
        input.replacementId,
        input.chapterId,
      );
      if (!converged) throw new ChapterReplacementNotFoundError();
      if (converged.status === "completed")
        return this.completedProjection(converged.id, converged.chapterId);
      return projectState(converged);
    }
  }

  private async loadAndAuthorize(input: {
    replacementId: string;
    chapterId: string;
    context: AuthorizationContext;
  }) {
    const operation = await this.operations.findByIdForChapter(
      input.replacementId,
      input.chapterId,
    );
    if (!operation) throw new ChapterReplacementNotFoundError();
    const decision = await this.authorization.check({
      context: input.context,
      chapterId: operation.chapterId,
      permission: "chapters.replace",
    });
    if (decision.reason === "not-found")
      throw new ChapterReplacementNotFoundError();
    if (!decision.allowed) throw new ChapterReplacementDeniedError();
    return operation;
  }

  private async completedProjection(replacementId: string, chapterId: string) {
    const result = await this.operations.getCompletedResult(replacementId);
    if (!result) throw new ChapterReplacementInvariantError();
    return { replacementId, chapterId, status: "completed" as const, result };
  }
}

function projectState(operation: {
  id: string;
  chapterId: string;
  status: ChapterReplacementStatus;
  lastErrorCode: string | null;
}): ChapterReplacementProjection {
  if (operation.status === "completed")
    throw new ChapterReplacementInvariantError();
  return {
    replacementId: operation.id,
    chapterId: operation.chapterId,
    status: operation.status,
    ...(operation.status === "failed" && operation.lastErrorCode
      ? { errorCode: operation.lastErrorCode }
      : {}),
  };
}
