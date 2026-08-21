import type { Permission } from "../../domain/permissions.js";
import type { ResourceContext } from "../../domain/authorization.types.js";
import type { Role } from "../../domain/roles.js";

export interface AuthorizationRoleRepository {
  findRoleByUserId(userId: string): Promise<string | null>;
}

export interface AuthorizationAuditRepository {
  append(input: {
    actorId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface AuthorizationConfigRepository {
  getHelperCooldownDays(): Promise<number>;
}

export interface ResourceAuthorizationPort {
  evaluate(
    userId: string,
    permission: Permission,
    resource: ResourceContext,
  ): Promise<boolean>;
}

export type ResolvedAuthorizationRole = Role | string;
