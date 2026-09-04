import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import type { ChapterImageAuthorizationPort } from "../../images/application/ports.js";
import type { ChapterReplacementResult } from "../domain/chapter-replacement-result.js";
import type { ChapterMediaReplacementRepository } from "./ports/chapter-media-replacement.repository.js";
import type { ChapterReplacementOperationRepository } from "./ports/chapter-replacement-operation.repository.js";

export class ChapterReplacementActivationNotFoundError extends Error {}
export class ChapterReplacementActivationDeniedError extends Error {}
export class ChapterReplacementActivationConflictError extends Error {}
export class ChapterReplacementActivationInProgressError extends Error {}
export class ChapterReplacementActivationInvariantError extends Error {}

export class ChapterMediaActivationService {
  constructor(
    private readonly operations: ChapterReplacementOperationRepository,
    private readonly repository: ChapterMediaReplacementRepository,
    private readonly permissions: ChapterImageAuthorizationPort,
  ) {}

  async execute(input: {
    replacementId: string;
    chapterId: string;
    context: AuthorizationContext;
    requestId?: string;
  }): Promise<ChapterReplacementResult> {
    const operation = await this.operations.findByIdForChapter(
      input.replacementId,
      input.chapterId,
    );
    if (!operation) throw new ChapterReplacementActivationNotFoundError();

    const authorization = await this.permissions.check({
      context: input.context,
      chapterId: input.chapterId,
      permission: "chapters.replace",
    });
    if (authorization.reason === "not-found")
      throw new ChapterReplacementActivationNotFoundError();
    if (!authorization.allowed)
      throw new ChapterReplacementActivationDeniedError();

    if (operation.status === "completed") {
      const result = await this.operations.getCompletedResult(operation.id);
      if (!result) throw new ChapterReplacementActivationInvariantError();
      return result;
    }
    if (operation.status === "completing")
      throw new ChapterReplacementActivationInProgressError();
    if (operation.status !== "ready")
      throw new ChapterReplacementActivationConflictError();

    const activated = await this.repository.activate({
      replacementId: input.replacementId,
      chapterId: input.chapterId,
      actorUserId: input.context.userId,
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    if (activated.outcome === "completed") return activated.result;
    if (activated.outcome === "not-found")
      throw new ChapterReplacementActivationNotFoundError();
    if (activated.outcome === "in-progress")
      throw new ChapterReplacementActivationInProgressError();
    if (activated.outcome === "invalid")
      throw new ChapterReplacementActivationInvariantError();
    throw new ChapterReplacementActivationConflictError();
  }
}
