import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import { isOwner } from "../../domain/series.policy.js";
import type {
  ChapterCoreRepositoryPort,
  SeriesRepositoryPort,
} from "../ports/series.ports.js";

export class SeriesService {
  constructor(
    private readonly series: SeriesRepositoryPort,
    private readonly chapters: ChapterCoreRepositoryPort,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(
    context: AuthorizationContext,
    input: {
      title: string;
      slug: string;
      description?: string | null | undefined;
    },
  ) {
    this.requireSession(context);
    return this.series.create({ ...input, createdBy: context.userId });
  }

  async list(context: AuthorizationContext) {
    this.requireSession(context);
    return this.series.listByOwner(context.userId);
  }

  async get(context: AuthorizationContext, id: string) {
    const item = await this.findOwned(context, id, PERMISSIONS.SERIES_READ);
    return item;
  }

  async update(
    context: AuthorizationContext,
    id: string,
    input: {
      title?: string | undefined;
      slug?: string | undefined;
      description?: string | null | undefined;
    },
  ) {
    const owner = await this.findOwned(context, id, PERMISSIONS.SERIES_EDIT);
    if (!owner || "forbidden" in owner) return owner;
    return this.series.update(id, input);
  }

  async remove(context: AuthorizationContext, id: string) {
    const owner = await this.findOwned(context, id, PERMISSIONS.SERIES_DELETE);
    if (!owner || "forbidden" in owner) return owner;
    if ((await this.series.countChapters(id)) > 0)
      return { conflict: true as const };
    await this.series.delete(id);
    return { deleted: true as const };
  }

  async createChapter(
    context: AuthorizationContext,
    seriesId: string,
    input: { chapterNumber: number; title?: string | null | undefined },
  ) {
    const owner = await this.findOwned(
      context,
      seriesId,
      PERMISSIONS.CHAPTERS_CREATE,
    );
    if (!owner || "forbidden" in owner) return owner;
    return this.chapters.create({
      ...input,
      seriesId,
      createdBy: context.userId,
    });
  }

  async listChapters(context: AuthorizationContext, seriesId: string) {
    const owner = await this.findOwned(
      context,
      seriesId,
      PERMISSIONS.SERIES_READ,
    );
    if (!owner || "forbidden" in owner) return owner;
    return this.chapters.listBySeries(seriesId);
  }

  private async findOwned(
    context: AuthorizationContext,
    id: string,
    permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
  ) {
    this.requireSession(context);
    const item = await this.series.findById(id);
    if (!item) return null;
    const decision = await this.authorization.authorize(context, permission);
    if (!decision.allowed || !isOwner(context.userId, item.createdBy))
      return { forbidden: true as const };
    return item;
  }

  private requireSession(context: AuthorizationContext) {
    if (!context.userId || !context.sessionId)
      throw new Error("authentication-required");
  }
}
