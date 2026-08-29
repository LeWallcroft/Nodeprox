import { randomUUID } from "node:crypto";
import { AppError } from "../../../../errors/app-error.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import type { AuthorizationService } from "../../../authorization/application/services/authorization.service.js";
import { normalizeEmail } from "../../../authentication/domain/value-objects/email.js";
import type { PasswordHasherPort } from "../../../authentication/domain/contracts/authentication.contracts.js";
import type {
  UserRecord,
  UserStatus,
} from "../../../authentication/domain/entities/authentication.types.js";
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
