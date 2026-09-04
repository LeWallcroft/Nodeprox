import { sql } from "drizzle-orm";
import type { NodeProxTransaction } from "../../../../authorization/infrastructure/persistence/drizzle/transactional-authorization.js";

/** Shared transaction-scoped serialization for every media cutover in a Chapter. */
export async function acquireChapterMediaLock(
  tx: NodeProxTransaction,
  chapterId: string,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${chapterId}, 0))`,
  );
}
