import { eq } from "drizzle-orm";
import type { NodeProxTransaction } from "./client.js";
import { series } from "./schema/index.js";

export async function lockSeriesOperationalRow(
  tx: NodeProxTransaction,
  seriesId: string,
): Promise<{
  id: string;
  createdBy: string;
  operationalState: "active" | "inactive";
} | null> {
  return (
    (
      await tx
        .select({
          id: series.id,
          createdBy: series.createdBy,
          operationalState: series.operationalState,
        })
        .from(series)
        .where(eq(series.id, seriesId))
        .for("update")
        .limit(1)
    )[0] ?? null
  );
}
