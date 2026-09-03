import { asc, eq } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  images,
  imageVersions,
} from "../../../../../../../../database/schema/index.js";
import type { ImageRepositoryPort } from "../../../application/ports.js";
import type { ImageRecord } from "../../../domain/image.types.js";

type ImageRow = typeof images.$inferSelect & {
  physicalFilename: string;
  physicalStorageKey: string;
  physicalExtension: string;
  physicalContentType: string;
  physicalSizeBytes: number;
  physicalChecksum: string;
};

const toImage = (row: ImageRow): ImageRecord => ({
  id: row.id,
  chapterId: row.chapterId,
  filename: row.physicalFilename,
  storageKey: row.physicalStorageKey,
  extension: row.physicalExtension,
  contentType: row.physicalContentType,
  sizeBytes: row.physicalSizeBytes,
  sortOrder: row.sortOrder,
  checksum: row.physicalChecksum,
  warnings: row.warnings,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class DrizzleImageRepository implements ImageRepositoryPort {
  constructor(private readonly db: NodeProxDatabase) {}

  async listByChapterId(chapterId: string) {
    const rows = await this.db
      .select({
        ...columns(),
      })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(eq(images.chapterId, chapterId))
      .orderBy(asc(images.sortOrder));
    return rows.map(toImage);
  }

  async findById(imageId: string) {
    const [row] = await this.db
      .select({
        ...columns(),
      })
      .from(images)
      .innerJoin(imageVersions, eq(images.currentVersionId, imageVersions.id))
      .where(eq(images.id, imageId))
      .limit(1);
    return row ? toImage(row) : null;
  }
}

function columns() {
  return {
    id: images.id,
    chapterId: images.chapterId,
    filename: images.filename,
    storageKey: images.storageKey,
    extension: images.extension,
    contentType: images.contentType,
    sizeBytes: images.sizeBytes,
    sortOrder: images.sortOrder,
    checksum: images.checksum,
    warnings: images.warnings,
    currentVersionId: images.currentVersionId,
    createdAt: images.createdAt,
    updatedAt: images.updatedAt,
    physicalFilename: imageVersions.physicalFilename,
    physicalStorageKey: imageVersions.storageKey,
    physicalExtension: imageVersions.extension,
    physicalContentType: imageVersions.contentType,
    physicalSizeBytes: imageVersions.sizeBytes,
    physicalChecksum: imageVersions.checksum,
  };
}
