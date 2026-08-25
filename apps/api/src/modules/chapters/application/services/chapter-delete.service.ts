import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import { evaluateChapterDelete } from "../../domain/chapter-delete.policy.js";
import type { ChapterDeleteRepositoryPort } from "../ports/chapter-delete.ports.js";

export class ChapterDeleteService {
  constructor(
    private readonly chapters: ChapterDeleteRepositoryPort,
    private readonly authorization: AuthorizationService,
  ) {}

  async remove(context: AuthorizationContext, chapterId: string) {
    if (!context.userId || !context.sessionId)
      return { unauthenticated: true as const };
    const chapter = await this.chapters.findById(chapterId);
    if (!chapter) return { notFound: true as const };
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.CHAPTERS_DELETE,
    );
    if (!decision.allowed || !decision.role) return { denied: true as const };
    const assigned =
      decision.role === "uploader" &&
      this.chapters.isAssigned !== undefined &&
      (await this.chapters.isAssigned(chapter.seriesId, context.userId));
    const seriesOwner =
      decision.role === "gestor" &&
      this.chapters.isSeriesOwner !== undefined &&
      (await this.chapters.isSeriesOwner(chapter.seriesId, context.userId));
    const policy = evaluateChapterDelete({
      actorId: context.userId,
      actorRole: decision.role,
      chapterOwnerId: chapter.createdBy,
      permission: PERMISSIONS.CHAPTERS_DELETE,
      assigned,
      seriesOwner,
    });
    if (!policy.allowed) return { denied: true as const };
    await this.chapters.delete(chapterId);
    return { deleted: true as const };
  }
}
