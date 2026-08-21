import { and, eq, gt, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import {
  Argon2PasswordHasher,
  UserRepository,
} from "../../apps/api/src/modules/authentication/index.js";
import { SessionService } from "../../apps/api/src/modules/authentication/application/services/session.service.js";
import { SessionRepository } from "../../apps/api/src/modules/authentication/infrastructure/persistence/drizzle/session.repository.js";
import { SessionCookieAdapter } from "../../apps/api/src/modules/authentication/infrastructure/http/session-cookie.adapter.js";
import { hashSessionToken } from "../../apps/api/src/modules/authentication/infrastructure/crypto/session-token-generator.js";
import { optionalSession } from "../../apps/api/src/modules/authentication/presentation/session-guards.js";
import {
  getRequestContext,
  updateRequestContext,
} from "../../apps/api/src/plugins/request-context.js";
import { sessions, users } from "../../database/schema/index.js";
import { createDatabase } from "../../database/client.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const password = "correct horse battery staple";
const email = `auth-${randomUUID()}@example.com`;
const userId = randomUUID();
const hasher = new Argon2PasswordHasher();
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const secureApp = buildApp(
  { logger: false },
  { database: database.db, secureCookie: true },
);
const usersRepository = new UserRepository(database.db);
const sessionsRepository = new SessionRepository(database.db);

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

function rawToken(cookie: string): string {
  const token = cookie.split(";")[0]?.split("=")[1];
  if (!token) throw new Error("Expected raw session token");
  return decodeURIComponent(token);
}

async function sessionIdForCookie(cookie: string): Promise<string> {
  const row = (
    await database.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.tokenHash, hashSessionToken(rawToken(cookie))))
  )[0];
  if (!row) throw new Error("Expected session for cookie");
  return row.id;
}

async function login(target = app): Promise<string> {
  const response = await target.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  return cookieValue(response.headers["set-cookie"]);
}

beforeAll(async () => {
  await usersRepository.create({
    id: userId,
    email,
    passwordHash: await hasher.hash(password),
    status: "active",
  });
  const optionalService = new SessionService(
    usersRepository,
    sessionsRepository,
    hasher,
    updateRequestContext,
  );
  app.get(
    "/test/optional-session",
    {
      preHandler: optionalSession(
        optionalService,
        new SessionCookieAdapter(false),
      ),
    },
    async () => ({ context: getRequestContext() }),
  );
});

afterAll(async () => {
  await Promise.all([app.close(), secureApp.close()]);
  await database.sql.end();
});

describe("authentication HTTP and session lifecycle", () => {
  it("logs in, resolves the session, sets context, and logs out", async () => {
    const cookie = await login();
    const session = await app.inject({
      method: "GET",
      url: "/auth/session",
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user).toMatchObject({ id: userId, email });
    expect(session.json()).not.toHaveProperty("token");
    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);
    const cleared = cookieValue(logout.headers["set-cookie"]);
    expect(cleared).toContain("nodeprox_session=");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("SameSite=Lax");
    expect(cleared).toContain("Path=/");
    expect(cleared).toContain("Max-Age=0");
  });

  it("matches cookie set and clear policy in production", async () => {
    const cookie = await login(secureApp);
    expect(cookie).toContain("Secure");
    const logout = await secureApp.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie },
    });
    const cleared = cookieValue(logout.headers["set-cookie"]);
    expect(cleared).toContain("Secure");
    expect(cleared).toContain("HttpOnly");
    expect(cleared).toContain("SameSite=Lax");
    expect(cleared).toContain("Path=/");
  });

  it("supports optionalSession without authenticating absent or invalid cookies", async () => {
    const anonymous = await app.inject({
      method: "GET",
      url: "/test/optional-session",
    });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json().context.userId).toBeUndefined();
    const invalid = await app.inject({
      method: "GET",
      url: "/test/optional-session",
      headers: { cookie: "nodeprox_session=invalid" },
    });
    expect(invalid.statusCode).toBe(200);
    expect(invalid.json().context.userId).toBeUndefined();
    const validCookie = await login();
    const authenticated = await app.inject({
      method: "GET",
      url: "/test/optional-session",
      headers: { cookie: validCookie },
    });
    expect(authenticated.statusCode).toBe(200);
    expect(authenticated.json().context).toMatchObject({
      userId,
      sessionId: expect.any(String),
      requestId: expect.any(String),
    });
    const rawToken = validCookie.split(";")[0]?.split("=")[1];
    expect(rawToken).toBeDefined();
    expect(authenticated.body).not.toContain(rawToken as string);
  });

  it("requires a valid session and rejects invalid, revoked, expired, suspended, and disabled users", async () => {
    expect(
      (await app.inject({ method: "GET", url: "/auth/session" })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie: "nodeprox_session=invalid" },
        })
      ).statusCode,
    ).toBe(401);
    const revokedCookie = await login();
    await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: revokedCookie },
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie: revokedCookie },
        })
      ).statusCode,
    ).toBe(401);
    for (const status of ["suspended", "disabled"] as const) {
      const statusCookie = await login();
      await database.db
        .update(users)
        .set({ status })
        .where(eq(users.id, userId));
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/auth/session",
            headers: { cookie: statusCookie },
          })
        ).statusCode,
      ).toBe(401);
      await database.db
        .update(users)
        .set({ status: "active" })
        .where(eq(users.id, userId));
    }
    const expiredCookie = await login();
    const sessionId = await sessionIdForCookie(expiredCookie);
    await database.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(sessions.id, sessionId));
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie: expiredCookie },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("renews idle activity without exceeding absolute expiration", async () => {
    const cookie = await login();
    const sessionId = await sessionIdForCookie(cookie);
    const absolute = new Date(Date.now() + 90_000);
    const oldSeen = new Date(Date.now() - 10 * 60_000);
    await database.db
      .update(sessions)
      .set({
        lastSeenAt: oldSeen,
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        absoluteExpiresAt: absolute,
      })
      .where(eq(sessions.id, sessionId));
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(200);
    const updated = (
      await database.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
    ).at(0);
    expect(updated?.lastSeenAt?.getTime()).toBeGreaterThan(oldSeen.getTime());
    expect(updated?.expiresAt.getTime()).toBeLessThanOrEqual(
      absolute.getTime(),
    );
  });

  it("invalidates at absolute expiration", async () => {
    const cookie = await login();
    const sessionId = await sessionIdForCookie(cookie);
    await database.db
      .update(sessions)
      .set({
        expiresAt: new Date(Date.now() + 86_400_000),
        absoluteExpiresAt: new Date(Date.now() - 1),
      })
      .where(eq(sessions.id, sessionId));
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/auth/session",
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("allows only one successor during concurrent rotation", async () => {
    const cookie = await login();
    const sessionId = await sessionIdForCookie(cookie);
    const original = (
      await database.db
        .select({ createdAt: sessions.createdAt })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
    )[0];
    if (!original) throw new Error("Expected original session");
    await database.db
      .update(sessions)
      .set({
        expiresAt: new Date(Date.now() + 60_000),
        absoluteExpiresAt: new Date(Date.now() + 86_400_000),
      })
      .where(eq(sessions.id, sessionId));
    const responses = await Promise.all([
      app.inject({ method: "GET", url: "/auth/session", headers: { cookie } }),
      app.inject({ method: "GET", url: "/auth/session", headers: { cookie } }),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([
      200, 401,
    ]);
    const validSuccessors = await database.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.userId, userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          gt(sessions.createdAt, original.createdAt),
        ),
      );
    expect(validSuccessors).toHaveLength(1);
  });

  it("returns a generic error for invalid credentials", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "unknown@example.com", password: "wrong" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: "invalid-credentials",
      status: 401,
    });
  });
});
