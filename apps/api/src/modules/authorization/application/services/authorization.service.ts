import type {
  AuthorizationContext,
  AuthorizationDecision,
  CapabilityProjection,
  ResourceContext,
} from "../../domain/authorization.types.js";
import {
  PERMISSION_CATALOG,
  type Permission,
} from "../../domain/permissions.js";
import type { AuthorizationPolicy } from "../../domain/policies/authorization.policy.js";
import type {
  AuthorizationAuditRepository,
  AuthorizationConfigRepository,
  AuthorizationRoleRepository,
  ResourceAuthorizationPort,
} from "../ports/authorization.ports.js";

export class AuthorizationService {
  constructor(
    private readonly policy: AuthorizationPolicy,
    private readonly roles: AuthorizationRoleRepository,
    private readonly audit: AuthorizationAuditRepository,
    private readonly config: AuthorizationConfigRepository,
    private readonly resources?: ResourceAuthorizationPort,
  ) {}

  async authorize(
    context: AuthorizationContext,
    permission: Permission,
    resource?: ResourceContext,
  ): Promise<AuthorizationDecision> {
    if (!context.userId || !context.sessionId)
      return { allowed: false, reason: "unauthenticated" };
    try {
      const role = await this.roles.findRoleByUserId(context.userId);
      let resourceAllowed: boolean | undefined;
      if (resource && this.resources) {
        resourceAllowed = await this.resources.evaluate(
          context.userId,
          permission,
          resource,
        );
      }
      return this.policy.evaluate(role, permission, resource, resourceAllowed);
    } catch {
      return { allowed: false, reason: "policy-error" };
    }
  }

  async projectCapabilities(
    context: AuthorizationContext,
  ): Promise<CapabilityProjection> {
    const role = await this.roles.findRoleByUserId(context.userId);
    const decisions = await Promise.all(
      PERMISSION_CATALOG.map(async (permission) => ({
        permission,
        decision: await this.authorize(context, permission),
      })),
    );
    return {
      role:
        role === "admin" || role === "gestor" || role === "uploader"
          ? role
          : null,
      capabilities: decisions
        .filter(({ decision }) => decision.allowed)
        .map(({ permission }) => permission),
    };
  }

  async getActorRole(
    context: AuthorizationContext,
  ): Promise<"admin" | "gestor" | "uploader" | null> {
    if (!context.userId || !context.sessionId) return null;
    try {
      const role = await this.roles.findRoleByUserId(context.userId);
      return role === "admin" || role === "gestor" || role === "uploader"
        ? role
        : null;
    } catch {
      return null;
    }
  }

  async getHelperCooldownDays(): Promise<number> {
    return this.config.getHelperCooldownDays();
  }

  async getHelperCooldownDecision(): Promise<
    { allowed: true; days: number } | { allowed: false; reason: "policy-error" }
  > {
    try {
      const days = await this.getHelperCooldownDays();
      if (!Number.isInteger(days) || days < 0)
        throw new Error("invalid cooldown");
      return { allowed: true, days };
    } catch {
      return { allowed: false, reason: "policy-error" };
    }
  }

  async recordSensitiveEvent(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.audit.append(input);
  }
}
