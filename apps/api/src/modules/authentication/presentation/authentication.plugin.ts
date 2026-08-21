import type { FastifyInstance } from "fastify";
import { updateRequestContext } from "../../../plugins/request-context.js";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import { SessionCookieAdapter } from "../infrastructure/http/session-cookie.adapter.js";
import { Argon2PasswordHasher } from "../infrastructure/crypto/argon2-password-hasher.js";
import { registerAuthenticationController } from "./authentication.controller.js";
import { SessionRepository } from "../infrastructure/persistence/drizzle/session.repository.js";
import { SessionService } from "../application/services/session.service.js";
import { UserRepository } from "../infrastructure/persistence/drizzle/user.repository.js";
export { optionalSession, requireSession } from "./session-guards.js";

export function registerAuthentication(
  app: FastifyInstance,
  db: NodeProxDatabase,
  secureCookie: boolean,
): void {
  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const service = new SessionService(
    users,
    sessions,
    new Argon2PasswordHasher(),
    updateRequestContext,
  );
  registerAuthenticationController(
    app,
    service,
    new SessionCookieAdapter(secureCookie),
  );
}
