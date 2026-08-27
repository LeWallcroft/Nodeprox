import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { ChapterPermissionService } from "./chapter-permission.service.js";
import type { ChapterCoreRepositoryPort } from "../../../series/application/ports/series.ports.js";
import type { ChapterMutationBoundaryPort } from "../ports/chapter-mutation.ports.js";

export class ChapterCoreService {
  constructor(
    private readonly chapters: ChapterCoreRepositoryPort,
    private readonly permissions: ChapterPermissionService,
    private readonly mutations: ChapterMutationBoundaryPort,
  ) {}

  async get(context: AuthorizationContext, id: string) {
    const chapter = await this.chapters.findById(id);
    if (!chapter) return { notFound: true as const };
    const decision = await this.permissions.check({
      context,
      chapterId: id,
      permission: "chapters.read",
    });
    if (!decision.allowed) return { denied: true as const };
    return { chapter };
  }

  async update(
    context: AuthorizationContext,
    id: string,
    input: {
      chapterNumber?: number | undefined;
      title?: string | null | undefined;
    },
  ) {
    const chapter = await this.chapters.findById(id);
    if (!chapter) return { notFound: true as const };
    const decision = await this.permissions.check({
      context,
      chapterId: id,
      permission: "chapters.edit",
    });
    if (!decision.allowed) return { denied: true as const };
    if (
      input.chapterNumber !== undefined &&
      input.chapterNumber !== chapter.chapterNumber
    )
      return { conflict: true as const };
    const result = await this.mutations.updateIfAuthorized({
      actor: context,
      chapterId: id,
      expectedChapterNumber: chapter.chapterNumber,
      mutation: input,
    });
    if (result.outcome === "denied") return { denied: true as const };
    if (result.outcome === "not-found") return { notFound: true as const };
    if (result.outcome === "conflict") return { conflict: true as const };
    return { chapter: result.chapter };
  }
}
