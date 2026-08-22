import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { ChapterPermissionService } from "./chapter-permission.service.js";
import type { ChapterCoreRepositoryPort } from "../../../series/application/ports/series.ports.js";

export class ChapterCoreService {
  constructor(
    private readonly chapters: ChapterCoreRepositoryPort,
    private readonly permissions: ChapterPermissionService,
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
    const updated = await this.chapters.update(id, input);
    return updated ? { chapter: updated } : { notFound: true as const };
  }
}
