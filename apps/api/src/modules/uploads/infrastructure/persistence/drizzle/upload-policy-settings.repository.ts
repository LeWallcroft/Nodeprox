import { inArray } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { systemConfig } from "../../../../../../../../database/schema/index.js";
import type { UploadPolicySettingsPort } from "../../../application/ports/upload-policy-settings.port.js";

export class DrizzleUploadPolicySettingsRepository
  implements UploadPolicySettingsPort
{
  constructor(private readonly db: NodeProxDatabase) {}

  async readNumbers(
    keys: readonly string[],
  ): Promise<ReadonlyMap<string, number>> {
    if (!keys.length) return new Map();
    const rows = await this.db
      .select({ key: systemConfig.key, value: systemConfig.value })
      .from(systemConfig)
      .where(inArray(systemConfig.key, [...keys]));
    return new Map(
      rows.flatMap((row) =>
        typeof row.value === "number" && Number.isFinite(row.value)
          ? [[row.key, row.value] as const]
          : [],
      ),
    );
  }
}
