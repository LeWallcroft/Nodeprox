import type { createDatabase } from "../../../../../../../database/client.js";
import type { DiscordProfileSyncLeasePort } from "../../application/discord-profile-sync.lease.js";

const lockExpression = `hashtextextended('nodeprox:discord-profile-sync', 0)`;

export class PostgresDiscordProfileSyncLease
  implements DiscordProfileSyncLeasePort
{
  constructor(private readonly sql: ReturnType<typeof createDatabase>["sql"]) {}

  async tryAcquire() {
    const reserved = await this.sql.reserve();
    try {
      const [result] = await reserved.unsafe(
        `select pg_try_advisory_lock(${lockExpression}) as locked`,
      );
      if (result?.locked !== true) {
        reserved.release();
        return null;
      }
      let released = false;
      return {
        async release() {
          if (released) return;
          try {
            await reserved.unsafe(
              `select pg_advisory_unlock(${lockExpression})`,
            );
          } finally {
            released = true;
            reserved.release();
          }
        },
      };
    } catch (error) {
      reserved.release();
      throw error;
    }
  }
}
