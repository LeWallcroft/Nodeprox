import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import { evaluateChapterDelete } from "../../domain/chapter-delete.policy.js";
import type { ChapterDeleteRepositoryPort } from "../ports/chapter-delete.ports.js";
import type { ChapterMutationBoundaryPort } from "../ports/chapter-mutation.ports.js";

export class ChapterDeleteService {
  constructor(
    private readonly chapters: ChapterDeleteRepositoryPort,
    private readonly authorization: AuthorizationService,
    private readonly mutations: ChapterMutationBoundaryPort,
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
      actorRole: decision.role,
      permission: PERMISSIONS.CHAPTERS_DELETE,
      assigned,
      seriesOwner,
    });
    if (!policy.allowed) return { denied: true as const };
    const result = await this.mutations.deleteIfAuthorized({
      actor: context,
      chapterId,
    });
    if (result.outcome === "denied") return { denied: true as const };
    if (result.outcome === "not-found") return { notFound: true as const };
    if (result.outcome === "conflict") return { conflict: true as const };
    return { deletionRequested: true as const };
  }
}
