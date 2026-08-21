import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../../errors/app-error.js";
import type { SessionCookieAdapter } from "../infrastructure/http/session-cookie.adapter.js";
import type { SessionService } from "../application/services/session.service.js";

const authenticationRequired = new AppError({
  code: "authentication-required",
  detail: "Authentication is required.",
  statusCode: 401,
  title: "Authentication required",
  type: "https://nodeprox.dev/problems/authentication-required",
});

type ResolvedSession = Awaited<ReturnType<SessionService["resolve"]>>;
const resolvedSessions = new WeakMap<FastifyRequest, ResolvedSession>();

export function getResolvedSession(request: FastifyRequest): ResolvedSession {
  return resolvedSessions.get(request) ?? null;
}

export function optionalSession(
  service: SessionService,
  cookies: SessionCookieAdapter,
) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = cookies.read(request);
    if (token) resolvedSessions.set(request, await service.resolve(token));
  };
}

export function requireSession(
  service: SessionService,
  cookies: SessionCookieAdapter,
) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = cookies.read(request);
    const result = token ? await service.resolve(token) : null;
    if (!result) throw authenticationRequired;
    resolvedSessions.set(request, result);
  };
}
