import { and, eq, isNull } from "drizzle-orm";
import { knownPersistenceConflict } from "../../../../../../../../database/postgres-error.js";
import { users } from "../../../../../../../../database/schema/index.js";
import type { DiscordIdentityLinkWriter } from "../../../application/discord-gateway.service.js";

export class DrizzleDiscordIdentityLinkRepository
  implements DiscordIdentityLinkWriter
{
  async updateDiscordIdentity(input: {
    tx: Parameters<DiscordIdentityLinkWriter["updateDiscordIdentity"]>[0]["tx"];
    userId: string;
    discordId: string;
    discordUsername: string;
    discordAvatarUrl: string | null;
    syncedAt: Date;
  }): Promise<
    "linked" | "discord-id-already-linked" | "discord-link-already-exists"
  > {
    try {
      const [updated] = await input.tx
        .update(users)
        .set({
          discordId: input.discordId,
          discordUsername: input.discordUsername,
          avatarUrl: input.discordAvatarUrl,
          discordLinkedAt: input.syncedAt,
          discordProfileSyncedAt: input.syncedAt,
          updatedAt: input.syncedAt,
        })
        .where(and(eq(users.id, input.userId), isNull(users.discordId)))
        .returning({ id: users.id });
      return updated ? "linked" : "discord-link-already-exists";
    } catch (error) {
      if (knownPersistenceConflict(error, ["users_discord_id_unique"]))
        return "discord-id-already-linked";
      throw error;
    }
  }
}
