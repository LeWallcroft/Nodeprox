import { eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { users } from "../../../../../../../../database/schema/index.js";
import type { DiscordLinkedUserPort } from "../../../application/discord-linked-user.port.js";

export class DrizzleDiscordLinkedUserRepository
  implements DiscordLinkedUserPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async findDiscordId(userId: string) {
    const [user] = await this.db
      .select({ discordId: users.discordId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.discordId ?? null;
  }
}
