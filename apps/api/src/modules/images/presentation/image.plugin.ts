import {
  type UploadTransferGrant,
  UploadTransferObjectNotFoundError,
  UploadTransferProviderError,
} from "@nodeprox/storage/port";
import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AppError } from "../../../errors/app-error.js";
import { getRequestContext } from "../../../plugins/request-context.js";
import { ImageCandidateActivationNotFoundError } from "../application/services/activate-image-candidate.service.js";
import {
  type CompleteImageReplacementService,
  ImageReplacementCompletionDeniedError,
  ImageReplacementCompletionFailedError,
  ImageReplacementCompletionInProgressError,
  ImageReplacementCompletionInvalidError,
  ImageReplacementCompletionInvariantError,
  ImageReplacementCompletionNotFoundError,
} from "../application/services/complete-image-replacement.service.js";
import type { ImageQueryService } from "../application/services/image-query.service.js";
import {
  ChapterNotFoundError,
  ImageAccessDeniedError,
  ImageContentInfrastructureError,
  ImageContentNotFoundError,
  ImageNotFoundError,
} from "../application/services/image-query.service.js";
import {
  ImageReplacementPrepareDeniedError,
  ImageReplacementPrepareConflictError,
  ImageReplacementPrepareInvalidError,
  ImageReplacementPrepareNotFoundError,
  type PrepareImageReplacementService,
} from "../application/services/prepare-image-replacement.service.js";

const idSchema = z.object({ chapterId: z.uuid() }).strict();
const imageIdSchema = z.object({ imageId: z.uuid() }).strict();
const replacementSessionParamsSchema = z
  .object({ chapterId: z.uuid(), imageId: z.uuid() })
  .strict();
const replacementCompletionParamsSchema = z
  .object({
    chapterId: z.uuid(),
    imageId: z.uuid(),
    replacementId: z.uuid(),
  })
  .strict();
const replacementCompletionBodySchema = z.object({}).strict().optional();
const replacementSessionBodySchema = z
  .object({
    filename: z.string(),
    contentType: z.string(),
    sizeBytes: z.number(),
  })
  .strict();
const uploadHeadersSchema = z.record(z.string(), z.string());
const uploadGrantSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("single"),
      method: z.literal("PUT"),
      url: z.url(),
      headers: uploadHeadersSchema,
      expiresAt: z.string(),
    })
    .strict(),
  z
    .object({
      mode: z.literal("multipart"),
      partSizeBytes: z.number().int().positive(),
      parts: z
        .array(
          z
            .object({
              partNumber: z.number().int().positive(),
              method: z.literal("PUT"),
              url: z.url(),
              headers: uploadHeadersSchema,
            })
            .strict(),
        )
        .min(1),
      expiresAt: z.string(),
    })
    .strict(),
]);
const replacementSessionResponseSchema = z
  .object({
    replacementId: z.uuid(),
    imageId: z.uuid(),
    upload: uploadGrantSchema,
  })
  .strict();
const replacementCompletionResponseSchema = z
  .object({
    replacementId: z.uuid(),
    imageId: z.uuid(),
    chapterId: z.uuid(),
    status: z.enum(["uploaded", "completing", "completed"]),
  })
  .strict();
const REPLACEMENT_UPLOAD_GRANT_TTL_SECONDS = 15 * 60;

const problem = (
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

const invalid = problem(
  "validation-failed",
  "The request parameters are invalid.",
  422,
  "Validation failed",
);
const forbidden = problem(
  "authorization-denied",
  "You are not authorized to access this image.",
  403,
  "Forbidden",
);
const chapterNotFound = problem(
  "chapter-not-found",
  "The requested chapter was not found.",
  404,
  "Chapter not found",
);
const imageNotFound = problem(
  "image-not-found",
  "The requested image was not found.",
  404,
  "Image not found",
);
const contentNotFound = problem(
  "image-content-not-found",
  "The image content was not found.",
  404,
  "Image content not found",
);
const internal = problem(
  "internal-error",
  "The image content could not be served.",
  500,
  "Internal server error",
);
const replacementInvalid = problem(
  "image-replacement-invalid",
  "The image replacement metadata is invalid.",
  422,
  "Invalid image replacement",
);
const replacementForbidden = problem(
  "authorization-denied",
  "You are not authorized to replace this image.",
  403,
  "Forbidden",
);
const replacementNotFound = problem(
  "image-replacement-not-found",
  "The requested chapter or image was not found.",
  404,
  "Image replacement not found",
);
const replacementProviderUnavailable = problem(
  "upload-provider-unavailable",
  "The upload provider is temporarily unavailable.",
  503,
  "Upload provider unavailable",
);
const replacementCompletionRequestInvalid = problem(
  "image-replacement-request-invalid",
  "The replacement completion request is invalid.",
  400,
  "Invalid image replacement request",
);
const replacementCompletionConflict = problem(
  "image-replacement-conflict",
  "The replacement cannot be completed in its current state.",
  409,
  "Image replacement conflict",
);
const replacementCandidateNotFound = problem(
  "image-replacement-candidate-not-found",
  "The uploaded replacement candidate was not found.",
  404,
  "Image replacement candidate not found",
);

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw invalid;
  return result.data;
}

function parseReplacementCompletion<T extends z.ZodType>(
  schema: T,
  input: unknown,
): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) throw replacementCompletionRequestInvalid;
  return result.data;
}

function context() {
  const value = getRequestContext();
  if (!value?.userId || !value.sessionId) throw forbidden;
  return { userId: value.userId, sessionId: value.sessionId };
}

type ImageSessionGuard = (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export function registerImagePlugin(
  app: FastifyInstance,
  dependencies: {
    imageQueryService: ImageQueryService;
    sessionGuard: ImageSessionGuard;
    replacementPreparation: {
      service: PrepareImageReplacementService;
      storageExecution: StorageExecutionResolver;
    };
    replacementCompletion: {
      service: CompleteImageReplacementService;
    };
  },
): void {
  const {
    imageQueryService: service,
    sessionGuard: session,
    replacementPreparation,
    replacementCompletion,
  } = dependencies;

  app.get(
    "/chapters/:chapterId/images",
    { preHandler: session },
    async (request) => {
      const { chapterId } = parse(idSchema, request.params);
      try {
        return { images: await service.list(context(), chapterId) };
      } catch (error) {
        throw mapError(error);
      }
    },
  );

  app.get("/images/:imageId", { preHandler: session }, async (request) => {
    const { imageId } = parse(imageIdSchema, request.params);
    try {
      return await service.getMetadata(context(), imageId);
    } catch (error) {
      throw mapError(error);
    }
  });

  app.get(
    "/images/:imageId/content",
    { preHandler: session },
    async (request, reply) => {
      const { imageId } = parse(imageIdSchema, request.params);
      try {
        const result = await service.getContent(context(), imageId);
        reply.header("Content-Type", result.image.contentType);
        reply.header("Content-Length", result.image.sizeBytes);
        reply.header("Content-Disposition", "inline");
        reply.header("X-Content-Type-Options", "nosniff");
        return reply.send(result.stream);
      } catch (error) {
        throw mapError(error);
      }
    },
  );

  app.post(
    "/chapters/:chapterId/images/:imageId/replacement-session",
    { preHandler: session },
    async (request, reply) => {
      try {
        const { chapterId, imageId } = parse(
          replacementSessionParamsSchema,
          request.params,
        );
        const body = parse(replacementSessionBodySchema, request.body);
        const prepared = await replacementPreparation.service.execute({
          context: context(),
          chapterId,
          imageId,
          ...body,
        });
        const transfer =
          await replacementPreparation.storageExecution.uploadTransferFor(
            prepared.storageProfileId,
          );
        const upload = await transfer.initiate({
          key: prepared.candidateStorageKey,
          contentType: prepared.contentType,
          sizeBytes: prepared.sizeBytes,
          expiresInSeconds: REPLACEMENT_UPLOAD_GRANT_TTL_SECONDS,
        });
        return reply.code(201).send(
          replacementSessionResponseSchema.parse({
            replacementId: prepared.replacementId,
            imageId: prepared.imageId,
            upload: upload satisfies UploadTransferGrant,
          }),
        );
      } catch (error) {
        throw mapReplacementPreparationError(error);
      }
    },
  );

  app.post(
    "/chapters/:chapterId/images/:imageId/replacements/:replacementId/complete",
    { preHandler: session },
    async (request, reply) => {
      try {
        const { chapterId, imageId, replacementId } =
          parseReplacementCompletion(
            replacementCompletionParamsSchema,
            request.params,
          );
        parseReplacementCompletion(
          replacementCompletionBodySchema,
          request.body,
        );
        const requestId = getRequestContext()?.requestId;
        const result = await replacementCompletion.service.execute({
          context: context(),
          chapterId,
          imageId,
          replacementId,
          ...(requestId ? { requestId } : {}),
        });
        return reply.code(result.status === "completed" ? 200 : 202).send(
          replacementCompletionResponseSchema.parse({
            replacementId: result.replacementId,
            imageId: result.imageId,
            chapterId: result.chapterId,
            status: result.status,
          }),
        );
      } catch (error) {
        throw mapReplacementCompletionError(error);
      }
    },
  );
}

function mapError(error: unknown): AppError {
  if (error instanceof ChapterNotFoundError) return chapterNotFound;
  if (error instanceof ImageNotFoundError) return imageNotFound;
  if (error instanceof ImageAccessDeniedError) return forbidden;
  if (error instanceof ImageContentNotFoundError) return contentNotFound;
  if (error instanceof ImageContentInfrastructureError) return internal;
  return error instanceof AppError ? error : internal;
}

function mapReplacementPreparationError(error: unknown): AppError {
  if (error instanceof ImageReplacementPrepareDeniedError)
    return replacementForbidden;
  if (error instanceof ImageReplacementPrepareNotFoundError)
    return replacementNotFound;
  if (error instanceof ImageReplacementPrepareInvalidError)
    return replacementInvalid;
  if (error instanceof ImageReplacementPrepareConflictError)
    return replacementCompletionConflict;
  if (error instanceof UploadTransferProviderError)
    return replacementProviderUnavailable;
  return error instanceof AppError ? error : internal;
}

function mapReplacementCompletionError(error: unknown): AppError {
  if (
    error instanceof ImageReplacementCompletionNotFoundError ||
    error instanceof ImageCandidateActivationNotFoundError
  )
    return replacementNotFound;
  if (error instanceof ImageReplacementCompletionDeniedError)
    return replacementForbidden;
  if (error instanceof UploadTransferObjectNotFoundError)
    return replacementCandidateNotFound;
  if (error instanceof UploadTransferProviderError)
    return replacementProviderUnavailable;
  if (
    error instanceof ImageReplacementCompletionInvalidError ||
    error instanceof ImageReplacementCompletionInProgressError ||
    error instanceof ImageReplacementCompletionFailedError ||
    error instanceof ImageReplacementCompletionInvariantError ||
    isReplacementCompletionConflict(error)
  )
    return replacementCompletionConflict;
  return error instanceof AppError ? error : internal;
}

function isReplacementCompletionConflict(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message === "image-replacement-operation-result-conflict" ||
      error.message === "image-replacement-operation-completion-conflict")
  );
}
