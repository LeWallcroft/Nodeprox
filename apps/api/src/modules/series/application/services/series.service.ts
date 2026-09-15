import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import { ChapterNumber } from "../../../chapters/domain/chapter-number.js";
import type { DiscordSeriesChannelGateway } from "../../../discord/application/discord-series-channel-gateway.js";
import { canAdministerSeries, isOwner } from "../../domain/series.policy.js";
import { canBeSeriesResponsible } from "../../domain/series-responsibility.policy.js";
import { SeriesSlug } from "../../domain/series-slug.js";
import type {
  ChapterCoreRepositoryPort,
  SeriesAssignmentRepositoryPort,
  SeriesMutationBoundaryPort,
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
    private readonly mutations: SeriesMutationBoundaryPort,
    private readonly seriesChannels?: DiscordSeriesChannelGateway,
  ) {}

  async create(
    context: AuthorizationContext,
    input: {
      title: string;
      description?: string | null | undefined;
      coverUrl?: string | null | undefined;
      grantId?: string | undefined;
      discordChannelId?: string | undefined;
    },
  ) {
    this.requireSession(context);
    const slug = SeriesSlug.fromTitle(input.title).toString();
    let decision = await this.authorization.authorize(
      context,
      PERMISSIONS.SERIES_CREATE,
    );
    if (!decision.allowed)
      decision = await this.authorization.authorize(
        context,
        PERMISSIONS.SERIES_CREATE_WITH_GRANT,
      );
    if (!decision.allowed || !decision.role)
      return { forbidden: true as const };
    const channel = await this.resolveSeriesChannel(
      decision.role,
      input.discordChannelId,
    );
    if (channel && "outcome" in channel) return channel;
    if (channel && (await this.series.isDiscordChannelBound?.(channel.id)))
      return { outcome: "channel-already-bound" as const };
    const result = await this.series.createWithCreationPolicy({
      title: input.title,
      description: input.description,
      coverUrl: input.coverUrl,
      grantId: input.grantId,
      ...(channel
        ? {
            discordChannelId: channel.id,
            discordChannelNameSnapshot: channel.name,
          }
        : {}),
      slug,
      createdBy: context.userId,
      actorRole: decision.role,
    });
    return result.outcome === "created" ? result.series : result;
  }

  private async resolveSeriesChannel(
    role: "admin" | "gestor" | "uploader",
    channelId: string | undefined,
  ): Promise<
    | { id: string; name: string }
    | undefined
    | {
        outcome:
          | "channel-required"
          | "channel-invalid"
          | "channel-already-bound"
          | "channel-validation-unavailable";
      }
  > {
    if (role !== "gestor") return undefined;
    if (!channelId) return { outcome: "channel-required" };
    if (!this.seriesChannels)
      return { outcome: "channel-validation-unavailable" };
    try {
      const result = await this.seriesChannels.validateChannel(channelId);
      return result.valid ? result.channel : { outcome: "channel-invalid" };
    } catch {
      return { outcome: "channel-validation-unavailable" };
    }
  }

  async list(context: AuthorizationContext) {
    this.requireSession(context);
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.SERIES_READ,
    );
    if (!decision.allowed) return [];
    if (decision.role === "admin")
      return this.withResponsibleUsers(await this.series.listAll());
    if (decision.role === "gestor")
      return this.withResponsibleUsers(await this.series.listAll());
    const ids = new Set(
      await this.assignments.listAssignedSeriesIds(context.userId),
    );
    const helperSeries = await this.series.listWithHelperAccess(context.userId);
    return this.withResponsibleUsers(
      [
        ...(await this.series.listAll()).filter((item) => ids.has(item.id)),
        ...helperSeries,
      ].filter(
        (item, index, values) =>
          values.findIndex((value) => value.id === item.id) === index,
      ),
    );
  }

  async get(context: AuthorizationContext, id: string) {
    const item = await this.findVisible(context, id);
    if (!item || "forbidden" in item) return item;
    return this.withResponsibleUser(item);
  }

  async projectCapabilities(context: AuthorizationContext, id: string) {
    const item = await this.findVisible(context, id);
    if (!item || "forbidden" in item) return item;

    const capabilities: string[] = [PERMISSIONS.SERIES_READ];
    for (const permission of [
      PERMISSIONS.SERIES_EDIT,
      PERMISSIONS.SERIES_DELETE,
      PERMISSIONS.CHAPTERS_HELPER_GRANT,
      PERMISSIONS.CHAPTERS_HELPER_REVOKE,
    ] as const) {
      const managed = await this.findManaged(context, id, permission);
      if (managed && !("forbidden" in managed)) capabilities.push(permission);
    }
    const chapterOperation = await this.findChapterOperational(context, id);
    if (chapterOperation && !("forbidden" in chapterOperation))
      capabilities.push(PERMISSIONS.CHAPTERS_CREATE);
    const importUpload = await this.authorization.authorize(
      context,
      PERMISSIONS.IMAGES_UPLOAD,
    );
    if (importUpload.allowed) capabilities.push(PERMISSIONS.IMAGES_UPLOAD);
    const assignment = await this.findManaged(
      context,
      id,
      PERMISSIONS.SERIES_ASSIGNMENT_MANAGE,
    );
    if (assignment && !("forbidden" in assignment))
      capabilities.push(PERMISSIONS.SERIES_ASSIGNMENT_MANAGE);
    return { capabilities };
  }

  async update(
    context: AuthorizationContext,
    id: string,
    input: {
      title?: string | undefined;
      description?: string | null | undefined;
      coverUrl?: string | null | undefined;
    },
  ) {
    const owner = await this.findManaged(context, id, PERMISSIONS.SERIES_EDIT);
    if (!owner || "forbidden" in owner) return owner;
    const result = await this.mutations.updateIfAuthorized({
      actor: context,
      seriesId: id,
      mutation: input,
    });
    if (result.outcome === "denied") return { forbidden: true as const };
    if (result.outcome === "not-found") return null;
    if (result.outcome === "conflict") return { conflict: true as const };
    if (result.outcome === "invalid-target") return { conflict: true as const };
    return result.series;
  }

  async remove(context: AuthorizationContext, id: string) {
    const owner = await this.findManaged(
      context,
      id,
      PERMISSIONS.SERIES_DELETE,
    );
    if (!owner || "forbidden" in owner) return owner;
    const result = await this.mutations.deleteIfAuthorized({
      actor: context,
      seriesId: id,
    });
    if (result.outcome === "denied") return { forbidden: true as const };
    if (result.outcome === "not-found") return null;
    if (result.outcome !== "deleted") return { conflict: true as const };
    return { deleted: true as const };
  }

  async createChapter(
    context: AuthorizationContext,
    seriesId: string,
    input: { chapterNumber: number; title?: string | null | undefined },
  ) {
    const operational = await this.findChapterOperational(context, seriesId);
    if (!operational || "forbidden" in operational) return operational;
    return this.chapters.create({
      ...input,
      chapterNumber: ChapterNumber.parse(input.chapterNumber).toNumber(),
      seriesId,
      createdBy: context.userId,
    });
  }

  async listChapters(context: AuthorizationContext, seriesId: string) {
    const owner = await this.findVisible(context, seriesId);
    if (!owner || "forbidden" in owner) return owner;
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.CHAPTERS_READ,
    );
    if (!decision.allowed) return { forbidden: true as const };
    return this.chapters.listBySeriesVisibleForActor({
      seriesId,
      userId: context.userId,
      role: decision.role,
    });
  }

  async listGlobalChapters(context: AuthorizationContext) {
    this.requireSession(context);
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.CHAPTERS_READ,
    );
    if (!decision.allowed) return [];
    return this.chapters.listVisibleForActor({
      userId: context.userId,
      role: decision.role,
    });
  }

  async assignResponsible(
    context: AuthorizationContext,
    seriesId: string,
    responsibleUserId: string,
  ) {
    const managed = await this.findManaged(
      context,
      seriesId,
      PERMISSIONS.SERIES_ASSIGNMENT_MANAGE,
    );
    if (!managed || "forbidden" in managed) return managed;
    const responsible = await this.users.findById(responsibleUserId);
    if (!canBeSeriesResponsible(responsible))
      return { invalidTarget: true as const };
    const result = await this.mutations.assignIfAuthorized({
      actor: context,
      seriesId,
      responsibleUserId,
    });
    if (result.outcome === "denied") return { forbidden: true as const };
    if (result.outcome === "not-found") return null;
    if (result.outcome === "invalid-target")
      return { invalidTarget: true as const };
    if (result.outcome === "conflict") return { conflict: true as const };
    return { assigned: true as const };
  }

  async assignUploader(
    context: AuthorizationContext,
    seriesId: string,
    uploaderId: string,
  ) {
    const uploader = await this.users.findById(uploaderId);
    if (!canBeSeriesResponsible(uploader) || uploader.role !== "uploader")
      return { invalidTarget: true as const };
    return this.assignResponsible(context, seriesId, uploaderId);
  }

  async listResponsibleCandidates(
    context: AuthorizationContext,
    seriesId: string,
  ) {
    const managed = await this.findManaged(
      context,
      seriesId,
      PERMISSIONS.SERIES_ASSIGNMENT_MANAGE,
    );
    if (!managed || "forbidden" in managed) return managed;
    return this.assignments.listActiveResponsibleCandidates();
  }

  private async withResponsibleUser(item: {
    id: string;
    responsibleUser: {
      id: string;
      email: string;
      role: "admin" | "gestor" | "uploader";
    } | null;
  }) {
    const responsibleUsers = await this.assignments.listResponsibleUsers([
      item.id,
    ]);
    return { ...item, responsibleUser: responsibleUsers.get(item.id) ?? null };
  }

  private async withResponsibleUsers<T extends { id: string }>(items: T[]) {
    const responsibleUsers = await this.assignments.listResponsibleUsers(
      items.map((item) => item.id),
    );
    return items.map((item) => ({
      ...item,
      responsibleUser: responsibleUsers.get(item.id) ?? null,
    }));
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
    if (await this.series.hasHelperAccess(id, context.userId)) return item;
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
    const isAssigned = await this.assignments.isAssigned(id, context.userId);
    if (
      !canAdministerSeries({
        role: decision.role,
        isOwner: isOwner(context.userId, item.createdBy),
        isAssigned,
      })
    )
      return { forbidden: true as const };
    return item;
  }

  private async findChapterOperational(
    context: AuthorizationContext,
    id: string,
  ) {
    this.requireSession(context);
    const item = await this.series.findById(id);
    if (!item) return null;
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.CHAPTERS_CREATE,
    );
    if (!decision.allowed) return { forbidden: true as const };
    if (decision.role === "admin" || decision.role === "gestor") return item;
    return (await this.assignments.isAssigned(id, context.userId))
      ? item
      : { forbidden: true as const };
  }

  private requireSession(context: AuthorizationContext) {
    if (!context.userId || !context.sessionId)
      throw new Error("authentication-required");
  }
}
