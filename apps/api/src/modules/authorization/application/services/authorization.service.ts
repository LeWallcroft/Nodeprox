import type {
  AuthorizationContext,
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
import type {
  AuthorizationFailureCode,
  AuthorizationResult,
  AuthorizationTechnicalFailure,
} from "../authorization-result.js";
import type { AuthorizationFailureReporter } from "../ports/authorization-failure-reporter.port.js";

export class AuthorizationService {
  constructor(
    private readonly policy: AuthorizationPolicy,
    private readonly roles: AuthorizationRoleRepository,
    private readonly audit: AuthorizationAuditRepository,
    private readonly config: AuthorizationConfigRepository,
    private readonly resources?: ResourceAuthorizationPort,
    private readonly failures?: AuthorizationFailureReporter,
  ) {}

  async authorize(
    context: AuthorizationContext,
    permission: Permission,
    resource?: ResourceContext,
  ): Promise<AuthorizationResult> {
    if (!context.userId || !context.sessionId)
      return { allowed: false, reason: "unauthenticated" };
    let role: string | null;
    try {
      role = await this.roles.findRoleByUserId(context.userId);
    } catch (error) {
      return this.technicalFailure(
        "role-lookup-failed",
        "authorize",
        error,
        context,
        permission,
        resource,
      );
    }
    let resourceAllowed: boolean | undefined;
    if (resource && this.resources) {
      try {
        resourceAllowed = await this.resources.evaluate(
          context.userId,
          permission,
          resource,
        );
      } catch (error) {
        return this.technicalFailure(
          "resource-evaluation-failed",
          "authorize",
          error,
          context,
          permission,
          resource,
        );
      }
    }
    try {
      return this.policy.evaluate(role, permission, resource, resourceAllowed);
    } catch (error) {
      return this.technicalFailure(
        "policy-evaluation-failed",
        "authorize",
        error,
        context,
        permission,
        resource,
      );
    }
  }

  async projectCapabilities(
    context: AuthorizationContext,
  ): Promise<CapabilityProjection> {
    let role: string | null;
    try {
      role = await this.roles.findRoleByUserId(context.userId);
    } catch (error) {
      this.reportFailure({
        code: "role-lookup-failed",
        operation: "projectCapabilities",
        actorId: context.userId,
        error,
      });
      return { role: null, capabilities: [] };
    }
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
    } catch (error) {
      this.reportFailure({
        code: "role-lookup-failed",
        operation: "getActorRole",
        actorId: context.userId,
        error,
      });
      return null;
    }
  }

  async getHelperCooldownDays(): Promise<number> {
    return this.config.getHelperCooldownDays();
  }

  async getHelperCooldownDecision(): Promise<
    { allowed: true; days: number } | AuthorizationTechnicalFailure
  > {
    let days: number;
    try {
      days = await this.getHelperCooldownDays();
    } catch (error) {
      return this.technicalFailure(
        "helper-cooldown-read-failed",
        "getHelperCooldownDecision",
        error,
      );
    }
    if (!Number.isInteger(days) || days < 0)
      return this.technicalFailure(
        "helper-cooldown-invalid",
        "getHelperCooldownDecision",
      );
    return { allowed: true, days };
  }

  private technicalFailure(
    code: AuthorizationFailureCode,
    operation: string,
    error?: unknown,
    context?: AuthorizationContext,
    permission?: Permission,
    resource?: ResourceContext,
  ): AuthorizationTechnicalFailure {
    this.reportFailure({
      code,
      operation,
      ...(context ? { actorId: context.userId } : {}),
      ...(permission ? { permission } : {}),
      ...(resource
        ? { resourceType: resource.type, resourceId: resource.id }
        : {}),
      ...(error === undefined ? {} : { error }),
    });
    return {
      allowed: false,
      reason: "authorization-unavailable",
      failureCode: code,
    };
  }

  private reportFailure(
    input: Parameters<AuthorizationFailureReporter["report"]>[0],
  ): void {
    try {
      this.failures?.report(input);
    } catch {
      // Diagnostics must never turn a denial into an exception or an allow.
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
