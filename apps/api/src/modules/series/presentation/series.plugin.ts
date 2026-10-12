import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { KnownPersistenceConflictError } from "../../../../../../database/postgres-error.js";
import { AppError } from "../../../errors/app-error.js";
import {
  getRequestContext,
  markOperationAuditRecorded,
  setOperationAuditContext,
} from "../../../plugins/request-context.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import { UserRepository } from "../../authentication/infrastructure/persistence/drizzle/user.repository.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import { ChapterCoreService } from "../../chapters/application/services/chapter-core.service.js";
import { ChapterDeleteService } from "../../chapters/application/services/chapter-delete.service.js";
import type { ChapterPermissionService } from "../../chapters/application/services/chapter-permission.service.js";
import { ChapterNumber } from "../../chapters/domain/chapter-number.js";
import type { DiscordSeriesChannelGateway } from "../../discord/application/discord-series-channel-gateway.js";
import type { DomainEventOutbox } from "../../events/application/domain-event-outbox.js";
import { SeriesService } from "../application/services/series.service.js";
import { SeriesLifecycleService } from "../application/services/series-lifecycle.service.js";
import { InvalidSeriesSlugError } from "../domain/series-slug.js";
import { SeriesInactiveError } from "../domain/series-operational.policy.js";
import {
  DrizzleChapterCoreRepository,
  DrizzleSeriesRepository,
} from "../infrastructure/persistence/drizzle/series.repository.js";
import { DrizzleSeriesLifecycleRepository } from "../infrastructure/persistence/drizzle/series-lifecycle.repository.js";

const idSchema = z.object({ seriesId: z.uuid() }).strict();
const userIdSchema = z.object({ userId: z.uuid() }).strict();
const chapterIdSchema = z.object({ chapterId: z.uuid() }).strict();
const externalCoverUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  });
const seriesCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    // Compatibility-only input: the backend always derives the persisted slug.
    slug: z
      .string()
      .trim()
      .min(1)
      .max(220)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    description: z.string().max(5000).nullable().optional(),
    coverUrl: externalCoverUrlSchema.nullable().optional(),
    grantId: z.uuid().optional(),
    discordChannelId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
const seriesPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(5000).nullable().optional(),
    coverUrl: externalCoverUrlSchema.nullable().optional(),
  })
  .strict();
const chapterCreateSchema = z
  .object({
    chapterNumber: z.number().finite().refine(ChapterNumber.isValid),
    title: z.string().trim().max(200).nullable().optional(),
  })
  .strict();
const chapterPatchSchema = chapterCreateSchema.partial().strict();
const responsibleAssignmentSchema = z
  .object({ responsibleUserId: z.uuid() })
  .strict();
const bulkResponsibleAssignmentSchema = z
  .object({ seriesIds: z.array(z.uuid()).max(100) })
  .strict()
  .superRefine(({ seriesIds }, context) => {
    if (new Set(seriesIds).size !== seriesIds.length) {
      context.addIssue({
        code: "custom",
        message: "seriesIds must not contain duplicates",
        path: ["seriesIds"],
      });
    }
  });
const legacyAssignmentSchema = z.object({ uploaderId: z.uuid() }).strict();
const seriesListQuerySchema = z
  .object({
    operationalState: z.enum(["active", "inactive"]).default("active"),
  })
  .strict();
const deactivateSchema = z
  .object({
    reason: z.enum(["dropped", "hiatus", "completed", "other"]),
    reasonDetail: z.string().max(1000).nullable().optional(),
  })
  .strict();
const noteSchema = z
  .object({ resolutionNote: z.string().max(1000).nullable().optional() })
  .strict();
const requestSchema = z
  .object({ note: z.string().max(1000).nullable().optional() })
  .strict();
const requestIdSchema = z
  .object({ seriesId: z.uuid(), requestId: z.uuid() })
  .strict();

const error = (
  code: string,
  detail: string,
  statusCode: number,
  title: string,
) =>
  new AppError({
    code,
    detail,
    statusCode,
    title,
    type: `https://nodeprox.dev/problems/${code}`,
  });
const unauthorized = error(
  "authentication-required",
  "Authentication is required.",
  401,
  "Authentication required",
);
const forbidden = error(
  "authorization-denied",
  "You are not authorized to perform this operation.",
  403,
  "Forbidden",
);
const notFound = error(
  "resource-not-found",
  "The requested resource was not found.",
  404,
  "Resource not found",
);
const conflict = error(
  "resource-conflict",
  "The requested operation conflicts with the current state.",
  409,
  "Conflict",
);
const seriesInactive = error(
  "series-inactive",
  "The Series is inactive.",
  409,
  "Series inactive",
);
const seriesActiveOperation = error(
  "series-active-operation",
  "The Series has an active operation.",
  409,
  "Series operation active",
);
const seriesHasMedia = error(
  "series-has-media",
  "The Series has media or storage history.",
  409,
  "Series has media",
);
const lifecycleInvalid = error(
  "series-lifecycle-transition-invalid",
  "The lifecycle transition is invalid.",
  409,
  "Invalid lifecycle transition",
);
const reactivationPending = error(
  "series-reactivation-already-pending",
  "A reactivation request is already pending.",
  409,
  "Request pending",
);
const requestNotFound = error(
  "series-reactivation-request-not-found",
  "The reactivation request was not found.",
  404,
  "Request not found",
);
const requestInvalidState = error(
  "series-reactivation-request-invalid-state",
  "The reactivation request cannot be reviewed in its current state.",
  409,
  "Invalid request state",
);
const invalidChapterTransition = error(
  "invalid-chapter-transition",
  "The requested Chapter lifecycle transition is not allowed.",
  409,
  "Invalid Chapter transition",
);
const chapterConflict = error(
  "chapter-conflict",
  "A chapter with this number already exists in the series.",
  409,
  "Chapter conflict",
);
const seriesSlugConflict = error(
  "series-slug-conflict",
  "A Series with this canonical slug already exists.",
  409,
  "Series slug conflict",
);
const invalidSeriesSlug = error(
  "series-slug-invalid",
  "The title does not produce a valid public slug.",
  422,
  "Invalid Series slug",
);
const invalid = error(
  "validation-failed",
  "The request payload is invalid.",
  422,
  "Validation failed",
);

function context() {
  const value = getRequestContext();
  if (!value?.userId || !value.sessionId) throw unauthorized;
  return { userId: value.userId, sessionId: value.sessionId };
}

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw invalid;
  return result.data;
}

export function registerSeriesPlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
  chapterPermissions: ChapterPermissionService,
  events?: DomainEventOutbox,
  seriesChannels?: DiscordSeriesChannelGateway,
) {
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );
  const repository = new DrizzleSeriesRepository(db, events);
  const chapters = new DrizzleChapterCoreRepository(db);
  const seriesService = new SeriesService(
    repository,
    chapters,
    authorization,
    repository,
    new UserRepository(db),
    repository,
    seriesChannels,
  );
  const lifecycleRepository = new DrizzleSeriesLifecycleRepository(db);
  const lifecycleService = new SeriesLifecycleService(
    lifecycleRepository,
    lifecycleRepository,
    seriesService,
  );

  function lifecycleOutcome(result: { outcome: string }) {
    if (result.outcome === "denied") throw forbidden;
    if (result.outcome === "not-found") throw notFound;
    if (result.outcome === "inactive") throw seriesInactive;
    if (result.outcome === "active-operation") throw seriesActiveOperation;
    if (result.outcome === "invalid-transition") throw lifecycleInvalid;
    if (result.outcome === "request-already-pending") throw reactivationPending;
    if (result.outcome === "request-not-found") throw requestNotFound;
    if (result.outcome === "request-invalid-state") throw requestInvalidState;
    return result;
  }
  const chapterCore = new ChapterCoreService(
    chapters,
    chapterPermissions,
    chapters,
  );
  const chapterDelete = new ChapterDeleteService(
    chapters,
    authorization,
    chapters,
  );

  app.post("/series", { preHandler: session }, async (request, reply) => {
    try {
      const { slug: _legacySlug, ...input } = parse(
        seriesCreateSchema,
        request.body,
      );
      const result = await seriesService.create(context(), input);
      if ("forbidden" in result) throw forbidden;
      if ("outcome" in result) {
        if (result.outcome === "channel-required")
          throw error(
            "series-channel-required",
            "A Discord channel is required.",
            422,
            "Discord channel required",
          );
        if (result.outcome === "channel-invalid")
          throw error(
            "series-channel-invalid",
            "The selected Discord channel is unavailable.",
            422,
            "Discord channel invalid",
          );
        if (result.outcome === "channel-already-bound")
          throw error(
            "series-channel-already-bound",
            "The selected Discord channel is already bound to another Series.",
            409,
            "Discord channel already bound",
          );
        if (result.outcome === "channel-validation-unavailable")
          throw error(
            "series-channel-validation-unavailable",
            "Discord channel validation is temporarily unavailable.",
            503,
            "Discord channel validation unavailable",
          );
        if (result.outcome === "grant-not-owned")
          throw error(
            "series-creation-grant-not-owned",
            "The Series creation grant does not belong to the current user.",
            403,
            "Forbidden",
          );
        if (result.outcome === "grant-unavailable")
          throw error(
            "series-creation-grant-already-consumed",
            "The Series creation grant is unavailable.",
            409,
            "Grant unavailable",
          );
        throw error(
          "series-creation-grant-not-found",
          "The Series creation grant was not found.",
          404,
          "Grant not found",
        );
      }
      return reply.code(201).send(result);
    } catch (cause) {
      if (cause instanceof InvalidSeriesSlugError) throw invalidSeriesSlug;
      if (
        cause instanceof KnownPersistenceConflictError &&
        cause.constraint === "series_slug_unique"
      )
        throw seriesSlugConflict;
      throw cause;
    }
  });

  app.get("/series", { preHandler: session }, async (request) =>
    seriesService.list(
      context(),
      parse(seriesListQuerySchema, request.query).operationalState,
    ),
  );

  app.get(
    "/series/:seriesId/lifecycle",
    { preHandler: session },
    async (request) => {
      const { seriesId } = parse(idSchema, request.params);
      const result = await lifecycleService.getDetail(context(), seriesId);
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      return result;
    },
  );

  app.post(
    "/series/:seriesId/deactivate",
    { preHandler: session },
    async (request) => {
      const { seriesId } = parse(idSchema, request.params);
      const body = parse(deactivateSchema, request.body);
      return lifecycleOutcome(
        await lifecycleService.deactivate(context(), {
          seriesId,
          ...body,
          requestId: getRequestContext()?.requestId,
        }),
      );
    },
  );

  app.post(
    "/series/:seriesId/reactivate",
    { preHandler: session },
    async (request) => {
      const { seriesId } = parse(idSchema, request.params);
      const body = parse(noteSchema, request.body ?? {});
      return lifecycleOutcome(
        await lifecycleService.reactivate(context(), {
          seriesId,
          ...body,
          requestId: getRequestContext()?.requestId,
        }),
      );
    },
  );

  app.post(
    "/series/:seriesId/reactivation-requests",
    { preHandler: session },
    async (request, reply) => {
      const { seriesId } = parse(idSchema, request.params);
      const body = parse(requestSchema, request.body ?? {});
      const result = lifecycleOutcome(
        await lifecycleService.requestReactivation(context(), {
          seriesId,
          ...body,
          requestId: getRequestContext()?.requestId,
        }),
      );
      return reply.code(201).send(result);
    },
  );

  app.post(
    "/series/:seriesId/reactivation-requests/:requestId/approve",
    { preHandler: session },
    async (request) => {
      const params = parse(requestIdSchema, request.params);
      const body = parse(noteSchema, request.body ?? {});
      return lifecycleOutcome(
        await lifecycleService.approveReactivation(context(), {
          ...params,
          ...body,
        }),
      );
    },
  );

  app.post(
    "/series/:seriesId/reactivation-requests/:requestId/reject",
    { preHandler: session },
    async (request) => {
      const params = parse(requestIdSchema, request.params);
      const body = parse(noteSchema, request.body ?? {});
      return lifecycleOutcome(
        await lifecycleService.rejectReactivation(context(), {
          ...params,
          ...body,
        }),
      );
    },
  );

  app.get("/chapters", { preHandler: session }, async () =>
    seriesService.listGlobalChapters(context()),
  );

  app.get("/series/:seriesId", { preHandler: session }, async (request) => {
    const { seriesId } = parse(idSchema, request.params);
    const result = await seriesService.get(context(), seriesId);
    if (!result) throw notFound;
    if ("forbidden" in result) throw forbidden;
    return result;
  });

  app.get(
    "/series/:seriesId/capabilities",
    { preHandler: session },
    async (request) => {
      const { seriesId } = parse(idSchema, request.params);
      const result = await seriesService.projectCapabilities(
        context(),
        seriesId,
      );
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      return result;
    },
  );

  app.get(
    "/series/:seriesId/responsible-candidates",
    { preHandler: session },
    async (request) => {
      const { seriesId } = parse(idSchema, request.params);
      const result = await seriesService.listResponsibleCandidates(
        context(),
        seriesId,
      );
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      return result;
    },
  );

  app.patch("/series/:seriesId", { preHandler: session }, async (request) => {
    const { seriesId } = parse(idSchema, request.params);
    try {
      const result = await seriesService.update(
        context(),
        seriesId,
        parse(seriesPatchSchema, request.body),
      );
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      if ("inactive" in result) throw seriesInactive;
      if ("conflict" in result) throw conflict;
      return result;
    } catch (cause) {
      throw cause;
    }
  });

  app.delete(
    "/series/:seriesId",
    { preHandler: session },
    async (request, reply) => {
      const { seriesId } = parse(idSchema, request.params);
      const result = await seriesService.remove(context(), seriesId);
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      if ("activeOperation" in result) throw seriesActiveOperation;
      if ("hasMedia" in result) throw seriesHasMedia;
      if ("conflict" in result) throw conflict;
      return reply.code(204).send();
    },
  );

  app.put(
    "/series/:seriesId/responsible",
    { preHandler: session },
    async (request) => {
      const { seriesId } = parse(idSchema, request.params);
      const { responsibleUserId } = parse(
        responsibleAssignmentSchema,
        request.body,
      );
      const result = await seriesService.assignResponsible(
        context(),
        seriesId,
        responsibleUserId,
      );
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      if ("inactive" in result) throw seriesInactive;
      if ("invalidTarget" in result) throw invalid;
      if ("conflict" in result) throw conflict;
      return { assigned: true };
    },
  );

  app.put(
    "/admin/users/:userId/series-responsibilities",
    { preHandler: session },
    async (request) => {
      const { userId } = parse(userIdSchema, request.params);
      const { seriesIds } = parse(
        bulkResponsibleAssignmentSchema,
        request.body,
      );
      const result = await seriesService.replaceUserAssignments(
        context(),
        userId,
        seriesIds,
      );
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      if ("inactive" in result) throw seriesInactive;
      if ("invalidTarget" in result) throw invalid;
      if ("conflict" in result) throw conflict;
      return {
        assigned: result.assigned,
        released: result.released,
        unchanged: result.unchanged,
      };
    },
  );

  app.put(
    "/series/:seriesId/uploader",
    { preHandler: session },
    async (request) => {
      const { seriesId } = parse(idSchema, request.params);
      const { uploaderId } = parse(legacyAssignmentSchema, request.body);
      const result = await seriesService.assignUploader(
        context(),
        seriesId,
        uploaderId,
      );
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      if ("inactive" in result) throw seriesInactive;
      if ("invalidTarget" in result) throw invalid;
      if ("conflict" in result) throw conflict;
      return { assigned: true };
    },
  );

  app.delete(
    "/series/:seriesId/uploader",
    { preHandler: session },
    async (request, reply) => {
      const { seriesId } = parse(idSchema, request.params);
      const result = await seriesService.releaseUploader(context(), seriesId);
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      if ("inactive" in result) throw seriesInactive;
      if ("invalidTarget" in result) throw invalid;
      if ("conflict" in result) throw conflict;
      return reply.code(204).send();
    },
  );

  app.post(
    "/series/:seriesId/chapters",
    { preHandler: session },
    async (request, reply) => {
      const { seriesId } = parse(idSchema, request.params);
      const payload = parse(chapterCreateSchema, request.body);
      setOperationAuditContext({
        action: "chapter.created",
        resourceType: "chapter",
        seriesId,
      });
      try {
        const result = await seriesService.createChapter(
          context(),
          seriesId,
          payload,
        );
        if (!result) throw notFound;
        if ("forbidden" in result) throw forbidden;
        const requestId = getRequestContext()?.requestId;
        await repository.appendAudit({
          actorId: context().userId,
          action: "chapter.created",
          resourceType: "chapter",
          resourceId: result.id,
          result: "success",
          ...(requestId ? { requestId } : {}),
        });
        markOperationAuditRecorded();
        return reply.code(201).send(result);
      } catch (cause) {
        if (cause instanceof SeriesInactiveError) throw seriesInactive;
        if (
          cause instanceof KnownPersistenceConflictError &&
          cause.constraint === "chapters_series_number_unique"
        ) {
          const requestContext = getRequestContext();
          request.log.info(
            {
              requestId: requestContext?.requestId,
              actorId: requestContext?.actorId ?? requestContext?.userId,
              seriesId,
              chapterNumber: payload.chapterNumber,
              code: "chapter-conflict",
            },
            "Chapter creation rejected because the chapter number conflicts",
          );
          throw chapterConflict;
        }
        throw cause;
      }
    },
  );

  app.get(
    "/series/:seriesId/chapters",
    { preHandler: session },
    async (request) => {
      const { seriesId } = parse(idSchema, request.params);
      const result = await seriesService.listChapters(context(), seriesId);
      if (!result) throw notFound;
      if ("forbidden" in result) throw forbidden;
      return result;
    },
  );

  app.get("/chapters/:chapterId", { preHandler: session }, async (request) => {
    const { chapterId } = parse(chapterIdSchema, request.params);
    const result = await chapterCore.get(context(), chapterId);
    if ("notFound" in result) throw notFound;
    if ("denied" in result) throw forbidden;
    return result.chapter;
  });

  app.get(
    "/chapters/:chapterId/capabilities",
    { preHandler: session },
    async (request) => {
      const { chapterId } = parse(chapterIdSchema, request.params);
      const result = await chapterPermissions.projectCapabilities(
        context(),
        chapterId,
      );
      if (result.capabilities.length === 0) {
        const chapter = await chapters.findById(chapterId);
        if (!chapter) throw notFound;
        throw forbidden;
      }
      return result;
    },
  );

  app.patch(
    "/chapters/:chapterId",
    { preHandler: session },
    async (request) => {
      const { chapterId } = parse(chapterIdSchema, request.params);
      try {
        const result = await chapterCore.update(
          context(),
          chapterId,
          parse(chapterPatchSchema, request.body),
        );
        if ("notFound" in result) throw notFound;
        if ("denied" in result) throw forbidden;
        if ("inactive" in result) throw seriesInactive;
        if ("conflict" in result) throw conflict;
        return result.chapter;
      } catch (cause) {
        throw cause;
      }
    },
  );

  app.delete(
    "/chapters/:chapterId",
    { preHandler: session },
    async (request, reply) => {
      const { chapterId } = parse(chapterIdSchema, request.params);
      const result = await chapterDelete.remove(context(), chapterId);
      if ("unauthenticated" in result) throw unauthorized;
      if ("notFound" in result) throw notFound;
      if ("denied" in result) throw forbidden;
      if ("inactive" in result) throw seriesInactive;
      if ("invalidTransition" in result) throw invalidChapterTransition;
      if ("conflict" in result) throw conflict;
      return reply.code(204).send();
    },
  );

  return { seriesService, chapterCore, chapterDelete };
}
