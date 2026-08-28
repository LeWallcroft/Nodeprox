import { AppError } from "../../../../errors/app-error.js";
import type {
  PasswordHasherPort,
  SessionRepositoryPort,
  UserRepositoryPort,
} from "../../domain/contracts/authentication.contracts.js";
import {
  createSessionId,
  createSessionToken,
  hashSessionToken,
} from "../../infrastructure/crypto/session-token-generator.js";
import type {
  AuthenticatedPrincipal,
  SessionWithUser,
} from "../../domain/entities/authentication.types.js";
import type { LoginInput } from "../dto/login.dto.js";
import { normalizeEmail } from "../../domain/value-objects/email.js";

const INVALID_CREDENTIALS = {
  code: "invalid-credentials",
  detail: "Invalid credentials.",
  statusCode: 401,
  title: "Authentication failed",
  type: "https://nodeprox.dev/problems/invalid-credentials",
} as const;

export class SessionService {
  constructor(
    private readonly users: UserRepositoryPort,
    private readonly sessions: SessionRepositoryPort,
    private readonly passwords: PasswordHasherPort,
    private readonly onAuthenticated: (
      principal: AuthenticatedPrincipal,
    ) => void = () => {},
  ) {}

  async authenticate(
    input: LoginInput,
  ): Promise<{ principal: AuthenticatedPrincipal; token: string }> {
    const email = normalizeEmail(input.email);
    const user = await this.users.findByEmail(email);
    if (!user) {
      await this.passwords.verifyDummy(input.password);
      throw new AppError(INVALID_CREDENTIALS);
    }
    if (user.status !== "active") {
      const valid = await this.passwords.verify(
        user.passwordHash,
        input.password,
      );
      if (valid && user.status === "pending")
        throw new AppError({
          code: "account-pending",
          detail: "The account is pending administrative approval.",
          statusCode: 403,
          title: "Account pending",
          type: "https://nodeprox.dev/problems/account-pending",
        });
      throw new AppError(INVALID_CREDENTIALS);
    }
    const valid = await this.passwords.verify(
      user.passwordHash,
      input.password,
    );
    if (!valid) throw new AppError(INVALID_CREDENTIALS);
    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.users.updatePasswordHash(
        user.id,
        await this.passwords.hash(input.password),
      );
    }

    const token = createSessionToken();
    const now = new Date();
    const session = await this.sessions.create({
      id: createSessionId(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      absoluteExpiresAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
      lastSeenAt: now,
    });
    const principal = { userId: user.id, sessionId: session.id };
    this.onAuthenticated(principal);
    return { principal, token };
  }

  async resolve(token: string): Promise<{
    principal: AuthenticatedPrincipal;
    user: Pick<SessionWithUser["user"], "id" | "email" | "status">;
    rotatedToken?: string;
  } | null> {
    const result: SessionWithUser | null =
      await this.sessions.findValidByTokenHash(
        hashSessionToken(token),
        new Date(),
      );
    if (!result) return null;
    let sessionId = result.session.id;
    let rotatedToken: string | undefined;
    const renewalWindow = 7 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const idleWindow = 5 * 60 * 1000;
    const idleExpiry = 30 * 24 * 60 * 60 * 1000;
    const shouldTouch =
      !result.session.lastSeenAt ||
      now.getTime() - result.session.lastSeenAt.getTime() >= idleWindow;
    if (result.session.expiresAt.getTime() - now.getTime() <= renewalWindow) {
      rotatedToken = createSessionToken();
      const next = await this.sessions.rotate(
        result.session.id,
        {
          id: createSessionId(),
          userId: result.user.id,
          tokenHash: hashSessionToken(rotatedToken),
          createdAt: now,
          expiresAt: new Date(
            Math.min(
              now.getTime() + idleExpiry,
              result.session.absoluteExpiresAt.getTime(),
            ),
          ),
          absoluteExpiresAt: result.session.absoluteExpiresAt,
          lastSeenAt: now,
        },
        now,
      );
      if (!next) return null;
      sessionId = next.id;
    } else if (shouldTouch) {
      await this.sessions.touch(
        result.session.id,
        now,
        new Date(
          Math.min(
            now.getTime() + idleExpiry,
            result.session.absoluteExpiresAt.getTime(),
          ),
        ),
      );
    }
    const principal = { userId: result.user.id, sessionId };
    this.onAuthenticated(principal);
    return {
      principal,
      user: {
        id: result.user.id,
        email: result.user.email,
        status: result.user.status,
      },
      ...(rotatedToken ? { rotatedToken } : {}),
    };
  }

  async revoke(token: string): Promise<void> {
    const result = await this.sessions.findByTokenHash(hashSessionToken(token));
    if (result) await this.sessions.revokeById(result.session.id, new Date());
  }
}
