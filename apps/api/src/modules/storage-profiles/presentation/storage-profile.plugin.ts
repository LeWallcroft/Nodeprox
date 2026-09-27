import type { NodeProxStorageProfileConfig } from "@nodeprox/config";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { AppError } from "../../../errors/app-error.js";
import {
  getRequestContext,
  markOperationAuditRecorded,
  setOperationAuditContext,
} from "../../../plugins/request-context.js";
import type { SessionService } from "../../authentication/application/services/session.service.js";
import type { SessionCookieAdapter } from "../../authentication/infrastructure/http/session-cookie.adapter.js";
import { requireSession } from "../../authentication/presentation/session-guards.js";
import type { AuthorizationService } from "../../authorization/application/services/authorization.service.js";
import {
  StorageProfileCipherUnavailableError,
  StorageProfileConflictError,
  StorageProfileForbiddenError,
  StorageProfileService,
} from "../application/storage-profile.service.js";
import { InvalidStorageHostnameLabelError } from "../domain/storage-profile.js";
import { AesGcmSecretCipher } from "../infrastructure/crypto/aes-gcm-secret-cipher.js";
import { DrizzleStorageProfileRepository } from "../infrastructure/persistence/drizzle/storage-profile.repository.js";

const draftFields = {
  name: z.string().trim().min(1).max(120),
  publicHostnameLabel: z.string().trim().min(1).max(63),
  b2Endpoint: z.url().nullable().optional(),
  b2Region: z.string().trim().min(1).max(120).nullable().optional(),
  b2Bucket: z.string().trim().min(1).max(255).nullable().optional(),
  b2KeyId: z.string().trim().min(1).max(255).nullable().optional(),
  b2ApplicationKey: z.string().min(1).max(2048).optional(),
};
const createSchema = z.object(draftFields).strict();
const patchSchema = createSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0);
const paramsSchema = z.object({ id: z.uuid() });

function problem(code: string, statusCode: number, detail: string) {
  return new AppError({
    code,
    detail,
    statusCode,
    title:
      statusCode === 403
        ? "Forbidden"
        : statusCode === 404
          ? "Not found"
          : statusCode === 409
            ? "Conflict"
            : statusCode === 503
              ? "Service unavailable"
              : "Validation failed",
    type: `https://nodeprox.dev/problems/${code}`,
  });
}

function context() {
  const current = getRequestContext();
  if (!current?.userId || !current.sessionId)
    throw problem(
      "authentication-required",
      401,
      "Authentication is required.",
    );
  return { userId: current.userId, sessionId: current.sessionId };
}

async function handle<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof StorageProfileForbiddenError)
      throw problem(
        "authorization-denied",
        403,
        "Storage management is denied.",
      );
    if (error instanceof InvalidStorageHostnameLabelError)
      throw problem("validation-failed", 422, "Invalid media hostname label.");
    if (error instanceof StorageProfileConflictError)
      throw problem(
        "storage-profile-conflict",
        409,
        "Storage profile conflicts with current state.",
      );
    if (error instanceof StorageProfileCipherUnavailableError)
      throw problem(
        "storage-profile-cipher-unavailable",
        503,
        "Credential encryption is unavailable.",
      );
    throw error;
  }
}

export function registerStorageProfilePlugin(
  app: FastifyInstance,
  db: NodeProxDatabase,
  authentication: { service: SessionService; cookies: SessionCookieAdapter },
  authorization: AuthorizationService,
  config: NodeProxStorageProfileConfig,
) {
  const cipherKey = config.STORAGE_PROFILE_MASTER_KEY;
  const service = new StorageProfileService(
    new DrizzleStorageProfileRepository(db),
    authorization,
    cipherKey ? new AesGcmSecretCipher(cipherKey) : null,
    config.STORAGE_RESERVED_HOSTNAME_LABELS.split(",")
      .map((label) => label.trim())
      .filter(Boolean),
  );
  const session = requireSession(
    authentication.service,
    authentication.cookies,
  );

  app.get("/admin/storage/profiles", { preHandler: session }, () =>
    handle(() => service.list(context())),
  );
  app.get(
    "/admin/storage/profiles/:id",
    { preHandler: session },
    async (request) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success)
        throw problem("validation-failed", 422, "Invalid storage profile ID.");
      const profile = await handle(() =>
        service.find(context(), parsed.data.id),
      );
      if (!profile)
        throw problem(
          "storage-profile-not-found",
          404,
          "Storage profile not found.",
        );
      return profile;
    },
  );
  app.post(
    "/admin/storage/profiles",
    { preHandler: session },
    async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success)
        throw problem(
          "validation-failed",
          422,
          "Invalid storage profile draft.",
        );
      setOperationAuditContext({
        action: "storage.profile.draft.created",
        resourceType: "storage-profile",
      });
      const profile = await handle(() =>
        service.create(context(), parsed.data, getRequestContext()?.requestId),
      );
      markOperationAuditRecorded();
      reply.code(201);
      return profile;
    },
  );
  app.patch(
    "/admin/storage/profiles/:id",
    { preHandler: session },
    async (request) => {
      const params = paramsSchema.safeParse(request.params);
      const parsed = patchSchema.safeParse(request.body);
      if (!params.success || !parsed.success)
        throw problem(
          "validation-failed",
          422,
          "Invalid storage profile draft.",
        );
      setOperationAuditContext({
        action: "storage.profile.draft.updated",
        resourceType: "storage-profile",
        resourceId: params.data.id,
      });
      const profile = await handle(() =>
        service.update(
          context(),
          params.data.id,
          parsed.data,
          getRequestContext()?.requestId,
        ),
      );
      if (!profile)
        throw problem(
          "storage-profile-conflict",
          409,
          "Only managed drafts can be edited.",
        );
      markOperationAuditRecorded();
      return profile;
    },
  );
}
