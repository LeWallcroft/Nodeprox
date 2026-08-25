import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import { isOwner } from "../../domain/series.policy.js";
import type {
  ChapterCoreRepositoryPort,
  SeriesAssignmentRepositoryPort,
  SeriesRepositoryPort,
  SeriesUserPort,
} from "../ports/series.ports.js";

export class SeriesService {
  constructor(
    private readonly series: SeriesRepositoryPort,
    private readonly chapters: ChapterCoreRepositoryPort,
    private readonly authorization: AuthorizationService,
    private readonly assignments: SeriesAssignmentRepositoryPort,
    private readonly users: SeriesUserPort,
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
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.SERIES_CREATE,
    );
    if (!decision.allowed) return { forbidden: true as const };
    return this.series.create({ ...input, createdBy: context.userId });
  }

  async list(context: AuthorizationContext) {
    this.requireSession(context);
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.SERIES_READ,
    );
    if (!decision.allowed) return [];
    if (decision.role === "uploader") {
      const ids = new Set(
        await this.assignments.listAssignedSeriesIds(context.userId),
      );
      return (await this.series.listAll()).filter((item) => ids.has(item.id));
    }
    return this.series.listAll();
  }

  async get(context: AuthorizationContext, id: string) {
    const item = await this.findVisible(context, id);
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
    const owner = await this.findManaged(context, id, PERMISSIONS.SERIES_EDIT);
    if (!owner || "forbidden" in owner) return owner;
    return this.series.update(id, input);
  }

  async remove(context: AuthorizationContext, id: string) {
    const owner = await this.findManaged(
      context,
      id,
      PERMISSIONS.SERIES_DELETE,
    );
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
    const owner = await this.findManaged(
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
    const owner = await this.findVisible(context, seriesId);
    if (!owner || "forbidden" in owner) return owner;
    return this.chapters.listBySeries(seriesId);
  }

  async assignUploader(
    context: AuthorizationContext,
    seriesId: string,
    uploaderId: string,
  ) {
    const managed = await this.findManaged(
      context,
      seriesId,
      PERMISSIONS.SERIES_EDIT,
    );
    if (!managed || "forbidden" in managed) return managed;
    const uploader = await this.users.findById(uploaderId);
    if (uploader?.status !== "active" || uploader?.role !== "uploader")
      return { invalidTarget: true as const };
    await this.assignments.assign({
      seriesId,
      uploaderId,
      assignedBy: context.userId,
    });
    return { assigned: true as const };
  }

  async clearUploader(context: AuthorizationContext, seriesId: string) {
    const managed = await this.findManaged(
      context,
      seriesId,
      PERMISSIONS.SERIES_EDIT,
    );
    if (!managed || "forbidden" in managed) return managed;
    await this.assignments.clear(seriesId);
    return { cleared: true as const };
  }

  private async findVisible(context: AuthorizationContext, id: string) {
    this.requireSession(context);
    const item = await this.series.findById(id);
    if (!item) return null;
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.SERIES_READ,
    );
    if (!decision.allowed) return { forbidden: true as const };
    if (
      decision.role === "admin" ||
      decision.role === "gestor" ||
      (await this.assignments.isAssigned(id, context.userId))
    )
      return item;
    return { forbidden: true as const };
  }

  private async findManaged(
    context: AuthorizationContext,
    id: string,
    permission: (typeof PERMISSIONS)[keyof typeof PERMISSIONS],
  ) {
    this.requireSession(context);
    const item = await this.series.findById(id);
    if (!item) return null;
    const decision = await this.authorization.authorize(context, permission);
    if (!decision.allowed) return { forbidden: true as const };
    if (decision.role === "admin") return item;
    if (decision.role === "uploader") {
      return (await this.assignments.isAssigned(id, context.userId))
        ? item
        : { forbidden: true as const };
    }
    if (!isOwner(context.userId, item.createdBy))
      return { forbidden: true as const };
    return item;
  }

  private requireSession(context: AuthorizationContext) {
    if (!context.userId || !context.sessionId)
      throw new Error("authentication-required");
  }
}
