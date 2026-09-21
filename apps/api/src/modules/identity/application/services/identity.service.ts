import { randomUUID } from "node:crypto";
import { AppError } from "../../../../errors/app-error.js";
import type { PasswordHasherPort } from "../../../authentication/domain/contracts/authentication.contracts.js";
import type {
  UserRecord,
  UserStatus,
} from "../../../authentication/domain/entities/authentication.types.js";
import { normalizeEmail } from "../../../authentication/domain/value-objects/email.js";
import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import type {
  IdentityRole,
  IdentityUserRepositoryPort,
} from "../ports/identity.ports.js";

const unauthorized = () =>
  new AppError({
    code: "authorization-denied",
    detail: "You are not authorized to manage users.",
    statusCode: 403,
    title: "Forbidden",
    type: "https://nodeprox.dev/problems/authorization-denied",
  });

export type PublicUserRecord = Pick<
  UserRecord,
  | "id"
  | "email"
  | "discordUsername"
  | "status"
  | "role"
  | "createdAt"
  | "updatedAt"
>;

export type ManagedUserProjection = PublicUserRecord & {
  assignedSeriesCount: number;
  lastAccessAt: Date | null;
};

function publicUser(user: UserRecord): PublicUserRecord {
  return {
    id: user.id,
    email: user.email,
    discordUsername: user.discordUsername ?? null,
    status: user.status,
    ...(user.role ? { role: user.role } : {}),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export class IdentityService {
  constructor(
    private readonly users: IdentityUserRepositoryPort,
    private readonly passwords: PasswordHasherPort,
    private readonly authorization: AuthorizationService,
  ) {}

  async register(input: {
    email: string;
    discordUsername?: string;
    password: string;
  }): Promise<PublicUserRecord> {
    const user = await this.users.create({
      id: randomUUID(),
      email: normalizeEmail(input.email),
      discordUsername: input.discordUsername?.trim() || null,
      passwordHash: await this.passwords.hash(input.password),
      status: "pending",
      role: "uploader",
    });
    return publicUser(user);
  }

  async list(context: AuthorizationContext): Promise<PublicUserRecord[]> {
    await this.requireAdmin(context);
    return (await this.users.list()).map(publicUser);
  }

  async listManagement(
    context: AuthorizationContext,
    input: {
      search?: string | undefined;
      status?: UserStatus | undefined;
      role?: IdentityRole | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ): Promise<{
    items: ManagedUserProjection[];
    nextCursor: string | null;
    total: number;
  }> {
    await this.requireAdmin(context);
    const cursor = input.cursor ? decodeLookupCursor(input.cursor) : undefined;
    const page = await this.users.listManagement({
      search: input.search,
      status: input.status,
      role: input.role,
      cursorEmail: cursor?.email,
      cursorId: cursor?.id,
      limit: input.limit,
    });
    const last = page.items.at(-1);
    return {
      items: page.items.map((user) => ({
        ...publicUser(user),
        assignedSeriesCount: user.assignedSeriesCount,
        lastAccessAt: user.lastAccessAt,
      })),
      nextCursor:
        page.hasMore && last
          ? Buffer.from(
              JSON.stringify({ email: last.email, id: last.id }),
            ).toString("base64url")
          : null,
      total: page.total,
    };
  }

  async lookup(
    context: AuthorizationContext,
    input: {
      search?: string | undefined;
      cursor?: string | undefined;
      limit: number;
    },
  ) {
    await this.requireUserLookup(context);
    const cursor = input.cursor ? decodeLookupCursor(input.cursor) : undefined;
    const rows = await this.users.lookup({
      search: input.search,
      cursorEmail: cursor?.email,
      cursorId: cursor?.id,
      limit: input.limit,
    });
    const page = rows.slice(0, input.limit);
    const last = page.at(-1);
    return {
      items: page.map((user) => ({
        id: user.id,
        displayName: user.email,
        email: user.email,
      })),
      nextCursor:
        rows.length > input.limit && last
          ? Buffer.from(
              JSON.stringify({ email: last.email, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }

  async review(
    context: AuthorizationContext,
    userId: string,
    input: {
      status: Extract<UserStatus, "active" | "rejected" | "suspended">;
      role?: IdentityRole | undefined;
    },
  ): Promise<PublicUserRecord | null> {
    await this.requireAdmin(context);
    const existing = await this.users.findById(userId);
    if (!existing) return null;
    if (!isReviewTransitionAllowed(existing, input))
      throw new IdentityStateConflictError();
    if (input.status === "suspended") {
      const result = await this.users.deactivate({
        id: userId,
        actorId: context.userId,
        expectedStatus: "active",
      });
      if (result.outcome === "not-found") return null;
      if (result.outcome === "conflict") throw new IdentityStateConflictError();
      if (result.outcome !== "deactivated")
        throw new IdentityStateConflictError();
      return publicUser(result.result.user);
    }
    const result = await this.users.review({
      id: userId,
      expectedStatus: existing.status,
      status: input.status,
      ...(input.role ? { role: input.role } : {}),
    });
    if (result.outcome === "conflict") throw new IdentityStateConflictError();
    return result.outcome === "updated" ? publicUser(result.user) : null;
  }

  private async requireAdmin(context: AuthorizationContext): Promise<void> {
    const decision = await this.authorization.authorize(
      context,
      PERMISSIONS.ADMIN_USERS_MANAGE,
    );
    if (!decision.allowed) throw unauthorized();
  }

  /**
   * This is a deliberately small, safe user directory projection.  Grant
   * issuers need it to select a target user, even though they are not allowed
   * to administer users generally.  User-management operations remain gated
   * by `admin.users.manage`.
   */
  private async requireUserLookup(
    context: AuthorizationContext,
  ): Promise<void> {
    const [manageUsers, issueGrant] = await Promise.all([
      this.authorization.authorize(context, PERMISSIONS.ADMIN_USERS_MANAGE),
      this.authorization.authorize(
        context,
        PERMISSIONS.DISCORD_SERIES_GRANT_ISSUE,
      ),
    ]);
    if (!manageUsers.allowed && !issueGrant.allowed) throw unauthorized();
  }
}

function decodeLookupCursor(value: string): { email: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof parsed?.email !== "string" || typeof parsed?.id !== "string")
      throw new Error("invalid cursor");
    return parsed;
  } catch {
    throw new AppError({
      code: "validation-failed",
      detail: "The lookup cursor is invalid.",
      statusCode: 422,
      title: "Validation failed",
      type: "https://nodeprox.dev/problems/validation-failed",
    });
  }
}

function isReviewTransitionAllowed(
  existing: UserRecord,
  input: {
    status: Extract<UserStatus, "active" | "rejected" | "suspended">;
    role?: IdentityRole | undefined;
  },
): boolean {
  if (existing.status === input.status)
    return input.role !== undefined && input.role !== existing.role;
  if (existing.status === "pending")
    return input.status === "active" || input.status === "rejected";
  if (existing.status === "active") return input.status === "suspended";
  if (existing.status === "suspended") return input.status === "active";
  return false;
}

export class IdentityStateConflictError extends Error {
  constructor() {
    super("identity-state-conflict");
    this.name = "IdentityStateConflictError";
  }
}
