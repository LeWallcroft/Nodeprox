import type { FastifyInstance } from "fastify";
import type { requireSession } from "../../authentication/presentation/session-guards.js";
import type { GetUserUploadPolicyService } from "../application/services/get-user-upload-policy.service.js";

export function registerUploadPolicyPlugin(
  app: FastifyInstance,
  dependencies: {
    service: GetUserUploadPolicyService;
    sessionGuard: ReturnType<typeof requireSession>;
  },
) {
  app.get(
    "/me/upload-policy",
    { preHandler: dependencies.sessionGuard },
    async () => dependencies.service.execute(),
  );
}
