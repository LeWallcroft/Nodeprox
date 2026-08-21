import type { FastifyRequest } from "fastify";
import { AppError } from "../../../errors/app-error.js";

const invalidOrigin = new AppError({
  code: "invalid-origin",
  detail: "The request origin is not allowed.",
  statusCode: 403,
  title: "Forbidden",
  type: "https://nodeprox.dev/problems/invalid-origin",
});

/** SameSite=Lax is the primary CSRF boundary. Mutating routes also reject an explicit cross-origin Origin. */
export function validateMutationOrigin(request: FastifyRequest): void {
  const origin = request.headers.origin;
  if (!origin) return;
  const protocol =
    request.headers["x-forwarded-proto"]?.toString().split(",")[0] ?? "http";
  if (origin !== `${protocol}://${request.headers.host}`) throw invalidOrigin;
}
