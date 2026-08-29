import {
  PERMISSIONS,
  type Permission,
} from "../../../authorization/domain/permissions.js";

export type OverviewVisibility = {
  canViewActiveUsers: boolean;
  canViewRecentActivity: boolean;
};

export function resolveOverviewVisibility(
  capabilities: readonly Permission[],
): OverviewVisibility {
  const available = new Set(capabilities);
  return {
    canViewActiveUsers: available.has(PERMISSIONS.ADMIN_USERS_MANAGE),
    canViewRecentActivity: available.has(PERMISSIONS.ADMIN_SYSTEM_MANAGE),
  };
}
