import type { Permission } from "./permissions.js";
import type { Role } from "./roles.js";

export type AuthorizationContext = {
  userId: string;
  sessionId: string;
};

export type ResourceContext = {
  type: string;
  id: string;
};

export type AuthorizationDenyReason =
  | "unauthenticated"
  | "unknown-role"
  | "unknown-permission"
  | "permission-denied"
  | "resource-context-unavailable";

export type AuthorizationDecision =
  | { allowed: true; role: Role }
  | { allowed: false; reason: AuthorizationDenyReason };

export type CapabilityProjection = {
  role: Role | null;
  capabilities: readonly Permission[];
};
