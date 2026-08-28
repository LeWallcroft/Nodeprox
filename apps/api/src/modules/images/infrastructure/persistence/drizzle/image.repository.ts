import { asc, eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import { images } from "../../../../../../../../database/schema/index.js";
import type { ImageRepositoryPort } from "../../../application/ports.js";
import type { ImageRecord } from "../../../domain/image.types.js";

const toImage = (row: typeof images.$inferSelect): ImageRecord => ({
  id: row.id,
  chapterId: row.chapterId,
  filename: row.filename,
  storageKey: row.storageKey,
  extension: row.extension,
  contentType: row.contentType,
  sizeBytes: row.sizeBytes,
  sortOrder: row.sortOrder,
  checksum: row.checksum,
  warnings: row.warnings,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class DrizzleImageRepository implements ImageRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async listByChapterId(chapterId: string) {
    const rows = await this.db
      .select()
      .from(images)
      .where(eq(images.chapterId, chapterId))
      .orderBy(asc(images.sortOrder));
    return rows.map(toImage);
  }

  async findById(imageId: string) {
    const [row] = await this.db
      .select()
      .from(images)
      .where(eq(images.id, imageId))
      .limit(1);
    return row ? toImage(row) : null;
  }
}
