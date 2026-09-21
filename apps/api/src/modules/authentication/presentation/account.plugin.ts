import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { NodeProxDatabase } from "../../../../../../database/client.js";
import {
  auditLogs,
  passwordResetTokens,
  sessions,
  users,
} from "../../../../../../database/schema/index.js";
import { AppError } from "../../../errors/app-error.js";
import { parseWithSchema } from "../../../http/validation.js";
import type { SessionService } from "../application/services/session.service.js";
import { Argon2PasswordHasher } from "../infrastructure/crypto/argon2-password-hasher.js";
import type { TransactionalEmailPort } from "../infrastructure/email/brevo-transactional-email.js";
import type { SessionCookieAdapter } from "../infrastructure/http/session-cookie.adapter.js";
import { validateMutationOrigin } from "./origin-policy.js";
import { getResolvedSession, requireSession } from "./session-guards.js";

const genericResetResponse = { accepted: true };
const requestSchema = z
  .object({ email: z.string().trim().email().max(320) })
  .strict();
const passwordSchema = z.string().min(8).max(256);
const completeSchema = z
  .object({ token: z.string().min(32).max(512), newPassword: passwordSchema })
  .strict();
const changeSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: passwordSchema,
  })
  .strict();
const profileSchema = z
  .object({ displayName: z.string().trim().min(1).max(120).nullable() })
  .strict();
const preferencesSchema = z
  .object({
    theme: z.enum(["dark", "system", "light"]).optional(),
    locale: z.string().trim().min(2).max(16).optional(),
    timeZone: z.string().trim().min(1).max(64).optional(),
    reducedMotion: z.boolean().optional(),
  })
  .strict();
const idSchema = z.object({ sessionId: z.uuid() }).strict();

class PasswordResetRateLimiter {
  private readonly hits = new Map<string, number[]>();
  allowed(key: string, now: number) {
    const windowStart = now - 15 * 60_000;
    const recent = (this.hits.get(key) ?? []).filter(
      (item) => item > windowStart,
    );
    recent.push(now);
    this.hits.set(key, recent);
    return recent.length <= 5;
  }
}

const limiter = new PasswordResetRateLimiter();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const maskIp = (value: string | null) => {
  if (!value) return null;
  const parts = value.split(".");
  return parts.length === 4
    ? `${parts[0]}.${parts[1]}.${parts[2]}.***`
    : "oculta";
};

export function registerAccountPlugin(
  app: FastifyInstance,
  input: {
    db: NodeProxDatabase;
    authentication: { service: SessionService; cookies: SessionCookieAdapter };
    email: TransactionalEmailPort;
    publicUrl: string;
    resetTtlMinutes: number;
  },
) {
  const session = requireSession(
    input.authentication.service,
    input.authentication.cookies,
  );
  // Request identity is intentionally resolved in each handler, not trusted from body.
  const principal = (request: Parameters<typeof getResolvedSession>[0]) => {
    const resolved = getResolvedSession(request);
    if (!resolved) throw new Error("session guard did not resolve a session");
    return resolved.principal;
  };

  app.post("/auth/password-reset/request", async (request) => {
    validateMutationOrigin(request);
    const { email } = parseWithSchema(requestSchema, request.body);
    const normalized = email.trim().toLowerCase();
    const key = hash(`${request.ip ?? "unknown"}:${normalized}`);
    if (!limiter.allowed(key, Date.now())) return genericResetResponse;
    const [user] = await input.db
      .select()
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    if (user?.status !== "active") return genericResetResponse;
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.resetTtlMinutes * 60_000);
    await input.db.transaction(async (tx) => {
      await tx
        .update(passwordResetTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(passwordResetTokens.userId, user.id),
            isNull(passwordResetTokens.consumedAt),
          ),
        );
      await tx.insert(passwordResetTokens).values({
        id: randomUUID(),
        userId: user.id,
        tokenHash: hash(token),
        expiresAt,
      });
      await tx.insert(auditLogs).values({
        actorId: user.id,
        action: "auth.password_reset.requested",
        resourceType: "user",
        resourceId: user.id,
        result: "success",
      });
    });
    try {
      const url = new URL("/reset-password", input.publicUrl);
      url.searchParams.set("token", token);
      await input.email.sendPasswordReset({
        to: user.email,
        resetUrl: url.toString(),
        expiresAt,
      });
    } catch (error) {
      app.log.error({ err: error }, "Password reset delivery failed");
    }
    return genericResetResponse;
  });

  app.post("/auth/password-reset/complete", async (request) => {
    validateMutationOrigin(request);
    const { token, newPassword } = parseWithSchema(
      completeSchema,
      request.body,
    );
    const now = new Date();
    const passwordHasher = new Argon2PasswordHasher();
    const result = await input.db.transaction(async (tx) => {
      const [record] = await tx
        .select({ token: passwordResetTokens, user: users })
        .from(passwordResetTokens)
        .innerJoin(users, eq(users.id, passwordResetTokens.userId))
        .where(
          and(
            eq(passwordResetTokens.tokenHash, hash(token)),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, now),
            eq(users.status, "active"),
          ),
        )
        .limit(1)
        .for("update");
      if (!record) return false;
      const [consumed] = await tx
        .update(passwordResetTokens)
        .set({ consumedAt: now })
        .where(
          and(
            eq(passwordResetTokens.id, record.token.id),
            isNull(passwordResetTokens.consumedAt),
          ),
        )
        .returning({ id: passwordResetTokens.id });
      if (!consumed) return false;
      await tx
        .update(users)
        .set({
          passwordHash: await passwordHasher.hash(newPassword),
          updatedAt: now,
        })
        .where(eq(users.id, record.user.id));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(
          and(eq(sessions.userId, record.user.id), isNull(sessions.revokedAt)),
        );
      await tx.insert(auditLogs).values({
        actorId: record.user.id,
        action: "auth.password_reset.completed",
        resourceType: "user",
        resourceId: record.user.id,
        result: "success",
      });
      return true;
    });
    if (!result)
      throw new AppError({
        code: "password-reset-token-invalid",
        detail: "The reset token is invalid or expired.",
        statusCode: 400,
        title: "Invalid reset token",
        type: "https://nodeprox.dev/problems/password-reset-token-invalid",
      });
    return { reset: true };
  });

  app.get("/me/profile", { preHandler: session }, async (request) => {
    const identity = principal(request);
    const [user] = await input.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        discordUsername: users.discordUsername,
        discordLinkedAt: users.discordLinkedAt,
      })
      .from(users)
      .where(eq(users.id, identity.userId))
      .limit(1);
    return user;
  });
  app.patch("/me/profile", { preHandler: session }, async (request) => {
    validateMutationOrigin(request);
    const identity = principal(request);
    const payload = parseWithSchema(profileSchema, request.body);
    const [user] = await input.db
      .update(users)
      .set({ displayName: payload.displayName, updatedAt: new Date() })
      .where(eq(users.id, identity.userId))
      .returning({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        discordUsername: users.discordUsername,
        discordLinkedAt: users.discordLinkedAt,
      });
    return user;
  });
  app.get("/me/preferences", { preHandler: session }, async (request) => {
    const identity = principal(request);
    const [user] = await input.db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, identity.userId))
      .limit(1);
    return { preferences: user?.preferences ?? {} };
  });
  app.patch("/me/preferences", { preHandler: session }, async (request) => {
    validateMutationOrigin(request);
    const identity = principal(request);
    const { preferences } = parseWithSchema(
      z.object({ preferences: preferencesSchema }).strict(),
      request.body,
    );
    const [user] = await input.db
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, identity.userId))
      .limit(1);
    await input.db
      .update(users)
      .set({
        preferences: { ...(user?.preferences ?? {}), ...preferences },
        updatedAt: new Date(),
      })
      .where(eq(users.id, identity.userId));
    return { preferences: { ...(user?.preferences ?? {}), ...preferences } };
  });
  app.post("/me/password/change", { preHandler: session }, async (request) => {
    validateMutationOrigin(request);
    const identity = principal(request);
    const { currentPassword, newPassword } = parseWithSchema(
      changeSchema,
      request.body,
    );
    const [user] = await input.db
      .select()
      .from(users)
      .where(eq(users.id, identity.userId))
      .limit(1);
    const passwords = new Argon2PasswordHasher();
    if (!user || !(await passwords.verify(user.passwordHash, currentPassword)))
      throw new AppError({
        code: "current-password-invalid",
        detail: "Current password is invalid.",
        statusCode: 400,
        title: "Invalid password",
        type: "https://nodeprox.dev/problems/current-password-invalid",
      });
    const now = new Date();
    await input.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          passwordHash: await passwords.hash(newPassword),
          updatedAt: now,
        })
        .where(eq(users.id, identity.userId));
      await tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(sessions.userId, identity.userId),
            isNull(sessions.revokedAt),
            ne(sessions.id, identity.sessionId),
          ),
        );
      await tx.insert(auditLogs).values({
        actorId: identity.userId,
        action: "auth.password.changed",
        resourceType: "user",
        resourceId: identity.userId,
        result: "success",
      });
    });
    return { changed: true };
  });
  app.get("/me/sessions", { preHandler: session }, async (request) => {
    const identity = principal(request);
    const rows = await input.db
      .select({
        id: sessions.id,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        ip: sessions.ip,
        userAgent: sessions.userAgent,
      })
      .from(sessions)
      .where(
        and(eq(sessions.userId, identity.userId), isNull(sessions.revokedAt)),
      )
      .orderBy(sessions.lastSeenAt);
    return {
      items: rows.map((row) => ({
        ...row,
        ip: maskIp(row.ip),
        current: row.id === identity.sessionId,
      })),
    };
  });
  app.delete(
    "/me/sessions/:sessionId",
    { preHandler: session },
    async (request, reply) => {
      validateMutationOrigin(request);
      const identity = principal(request);
      const { sessionId } = parseWithSchema(idSchema, request.params);
      if (sessionId === identity.sessionId)
        throw new AppError({
          code: "current-session-protected",
          detail: "Use logout to close the current session.",
          statusCode: 400,
          title: "Current session protected",
          type: "https://nodeprox.dev/problems/current-session-protected",
        });
      await input.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.userId, identity.userId),
            isNull(sessions.revokedAt),
          ),
        );
      return reply.code(204).send();
    },
  );
  app.post(
    "/me/sessions/revoke-others",
    { preHandler: session },
    async (request) => {
      validateMutationOrigin(request);
      const identity = principal(request);
      const revoked = await input.db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(sessions.userId, identity.userId),
            isNull(sessions.revokedAt),
            ne(sessions.id, identity.sessionId),
          ),
        )
        .returning({ id: sessions.id });
      return { revoked: revoked.length };
    },
  );
}
