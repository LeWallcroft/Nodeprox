import type {
  AuthorizationDecision,
  ResourceContext,
} from "../authorization.types.js";
import {
  isPermission,
  ROLE_PERMISSIONS,
  type Permission,
} from "../permissions.js";
import { isRole } from "../roles.js";

export interface AuthorizationPolicy {
  evaluate(
    role: string | null,
    permission: string,
    resource?: ResourceContext,
    resourceAllowed?: boolean,
  ): AuthorizationDecision;
}

export class DefaultAuthorizationPolicy implements AuthorizationPolicy {
  evaluate(
    rawRole: string | null,
    rawPermission: string,
    resource?: ResourceContext,
    resourceAllowed?: boolean,
  ): AuthorizationDecision {
    if (!isPermission(rawPermission))
      return { allowed: false, reason: "unknown-permission" };
    if (!rawRole || !isRole(rawRole))
      return { allowed: false, reason: "unknown-role" };

    const role = rawRole;
    const permission = rawPermission as Permission;
    if (!ROLE_PERMISSIONS[role].includes(permission))
      return { allowed: false, reason: "permission-denied" };
    if (role === "admin") return { allowed: true, role };
    if (!resource) return { allowed: true, role };
    if (resourceAllowed === undefined)
      return { allowed: false, reason: "resource-context-unavailable" };
    return resourceAllowed
      ? { allowed: true, role }
      : { allowed: false, reason: "permission-denied" };
  }
}
