import {
  and,
  asc,
  count,
  eq,
  gt,
  isNotNull,
  isNull,
  lte,
  min,
  or,
  sql,
} from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { users } from "../../../../../../../../database/schema/index.js";
import type { DiscordProfileRepository } from "../../../application/discord-profile.repository.js";

export class DrizzleDiscordProfileRepository
  implements DiscordProfileRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async findLinkedByDiscordId(discordId: string) {
    const [row] = await this.db
      .select({ userId: users.id, discordId: users.discordId })
      .from(users)
      .where(eq(users.discordId, discordId))
      .limit(1);
    return row?.discordId
      ? { userId: row.userId, discordId: row.discordId }
      : null;
  }

  listLinked(input: { afterId?: string; limit: number; staleBefore?: Date }) {
    return this.db
      .select({ userId: users.id, discordId: users.discordId })
      .from(users)
      .where(
        and(
          isNotNull(users.discordId),
          ...(input.afterId ? [gt(users.id, input.afterId)] : []),
          ...(input.staleBefore
            ? [
                or(
                  isNull(users.discordProfileSyncedAt),
                  lte(users.discordProfileSyncedAt, input.staleBefore),
                ),
              ]
            : []),
        ),
      )
      .orderBy(asc(users.id))
      .limit(input.limit)
      .then((rows) =>
        rows.flatMap((row) =>
          row.discordId ? [row as { userId: string; discordId: string }] : [],
        ),
      );
  }

  async updateDiscordProfile(input: {
    userId: string;
    expectedDiscordId: string;
    discordUsername: string;
    avatarUrl: string | null;
    syncedAt: Date;
  }): Promise<"changed" | "refreshed" | "link-changed"> {
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          discordUsername: users.discordUsername,
          avatarUrl: users.avatarUrl,
        })
        .from(users)
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.discordId, input.expectedDiscordId),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) return "link-changed";

      const changed =
        current.discordUsername !== input.discordUsername ||
        current.avatarUrl !== input.avatarUrl;
      await tx
        .update(users)
        .set({
          discordUsername: input.discordUsername,
          avatarUrl: input.avatarUrl,
          discordProfileSyncedAt: input.syncedAt,
          ...(changed ? { updatedAt: input.syncedAt } : {}),
        })
        .where(
          and(
            eq(users.id, input.userId),
            eq(users.discordId, input.expectedDiscordId),
          ),
        );
      return changed ? "changed" : "refreshed";
    });
  }

  async getSyncStatus(input: { staleBefore: Date }) {
    const [status] = await this.db
      .select({
        linkedUsers: count(users.id),
        missingAvatar: sql<number>`count(*) filter (where ${users.avatarUrl} is null)::int`,
        staleProfiles: sql<number>`count(*) filter (where ${isNull(users.discordProfileSyncedAt)} or ${lte(users.discordProfileSyncedAt, input.staleBefore)})::int`,
        oldestSyncedAt: min(users.discordProfileSyncedAt),
      })
      .from(users)
      .where(isNotNull(users.discordId));
    return {
      linkedUsers: status?.linkedUsers ?? 0,
      missingAvatar: status?.missingAvatar ?? 0,
      staleProfiles: status?.staleProfiles ?? 0,
      oldestSyncedAt: status?.oldestSyncedAt ?? null,
    };
  }
}
