import { and, asc, eq, gt, isNotNull } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { users } from "../../../../../../../../database/schema/index.js";
import type { DiscordProfileRepository } from "../../../application/discord-profile.repository.js";

export class DrizzleDiscordProfileRepository
  implements DiscordProfileRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  listLinked(input: { afterId?: string; limit: number }) {
    return this.db
      .select({ userId: users.id, discordId: users.discordId })
      .from(users)
      .where(
        and(
          isNotNull(users.discordId),
          ...(input.afterId ? [gt(users.id, input.afterId)] : []),
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
  }) {
    const rows = await this.db
      .update(users)
      .set({
        discordUsername: input.discordUsername,
        avatarUrl: input.avatarUrl,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(users.id, input.userId),
          eq(users.discordId, input.expectedDiscordId),
        ),
      )
      .returning({ id: users.id });
    return rows.length === 1;
  }
}
