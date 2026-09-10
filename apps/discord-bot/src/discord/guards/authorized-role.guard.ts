import type {
  DiscordAuthorizedRole,
  DiscordBotCapability,
} from "../../infrastructure/nodeprox-api/contracts.js";

export function getInteractionRoleIds(interaction: {
  member?: { roles?: unknown } | null;
}): string[] {
  const roles = interaction.member?.roles;
  if (Array.isArray(roles)) return [...new Set(roles.filter(Boolean))];
  if (!roles || typeof roles !== "object" || !("cache" in roles)) return [];
  const cache = roles.cache;
  if (!cache || typeof cache !== "object" || !("keys" in cache)) return [];
  const keys = cache.keys;
  if (typeof keys !== "function") return [];
  return [
    ...new Set(
      [...(keys.call(cache) as Iterable<unknown>)].filter(
        (roleId): roleId is string => typeof roleId === "string",
      ),
    ),
  ];
}

export function hasDiscordCapability(
  actorRoleIds: readonly string[],
  authorizedRoles: readonly DiscordAuthorizedRole[],
  capability: DiscordBotCapability,
) {
  const actorRoles = new Set(actorRoleIds);
  return authorizedRoles.some(
    (role) =>
      actorRoles.has(role.roleId) && role.capabilities.includes(capability),
  );
}
