import { and, eq, gt, isNull } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  sessions,
  users,
} from "../../../../../../../../database/schema/index.js";
import type { AuthorizationContext } from "../../../domain/authorization.types.js";
import type { Permission } from "../../../domain/permissions.js";
import type { Role } from "../../../domain/roles.js";
import { DefaultAuthorizationPolicy } from "../../../domain/policies/authorization.policy.js";

export type NodeProxTransaction = Parameters<
  Parameters<NodeProxDatabase["transaction"]>[0]
>[0];

export type LockedUser = {
  id: string;
  role: Role;
  status: string;
};

export async function lockCurrentAuthorization(input: {
  tx: NodeProxTransaction;
  actor: AuthorizationContext;
  permission: Permission;
  additionalUserIds?: readonly string[];
}): Promise<
  | { allowed: true; role: Role; usersById: ReadonlyMap<string, LockedUser> }
  | { allowed: false }
> {
  const now = new Date();
  const [session] = await input.tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(
      and(
        eq(sessions.id, input.actor.sessionId),
        eq(sessions.userId, input.actor.userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        gt(sessions.absoluteExpiresAt, now),
      ),
    )
    .limit(1)
    .for("update");
  if (!session) return { allowed: false };

  const userIds = [
    ...new Set([input.actor.userId, ...(input.additionalUserIds ?? [])]),
  ].sort();
  const usersById = new Map<string, LockedUser>();
  for (const userId of userIds) {
    const [user] = await input.tx
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (user) usersById.set(user.id, user);
  }
  const actor = usersById.get(input.actor.userId);
  if (actor?.status !== "active") return { allowed: false };
  const decision = new DefaultAuthorizationPolicy().evaluate(
    actor.role,
    input.permission,
  );
  return decision.allowed
    ? { allowed: true, role: decision.role, usersById }
    : { allowed: false };
}
