import type { DiscordAuthorizedRole, DiscordCapability } from "./types";

/**
 * Produces the authoritative role set expected by the admin boundary. It never
 * infers a capability: each selected capability remains explicit.
 */
export function normalizeDiscordAuthorizedRoles(
  roles: readonly DiscordAuthorizedRole[],
): DiscordAuthorizedRole[] {
  const byRole = new Map<string, Set<DiscordCapability>>();

  for (const role of roles) {
    const roleId = role.roleId.trim();
    if (!roleId) continue;

    const capabilities = byRole.get(roleId) ?? new Set<DiscordCapability>();
    for (const capability of role.capabilities) capabilities.add(capability);
    byRole.set(roleId, capabilities);
  }

  return [...byRole.entries()]
    .map(([roleId, capabilities]) => ({
      roleId,
      capabilities: [...capabilities].sort(),
    }))
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
}
