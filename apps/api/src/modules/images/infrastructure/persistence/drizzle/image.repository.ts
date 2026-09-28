import { and, asc, eq, isNull } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  images,
  imageVersions,
} from "../../../../../../../../database/schema/index.js";
import type { ImageRepositoryPort } from "../../../application/ports.js";
import type { ImageRecord } from "../../../domain/image.types.js";

type ImageRow = Omit<
  typeof images.$inferSelect,
  "retiredAt" | "retiredByChapterReplacementId" | "storageProfileId"
> & {
  physicalFilename: string;
  physicalStorageKey: string;
  physicalStorageProfileId: string;
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
  storageProfileId: row.physicalStorageProfileId,
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
      .where(and(eq(images.chapterId, chapterId), isNull(images.retiredAt)))
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
      .where(and(eq(images.id, imageId), isNull(images.retiredAt)))
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
    physicalStorageProfileId: imageVersions.storageProfileId,
    physicalExtension: imageVersions.extension,
    physicalContentType: imageVersions.contentType,
    physicalSizeBytes: imageVersions.sizeBytes,
    physicalChecksum: imageVersions.checksum,
  };
}
