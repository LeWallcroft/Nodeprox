import { randomUUID } from "node:crypto";
import type { NodeProxDatabase } from "../../../database/client.js";
import { images, imageVersions } from "../../../database/schema/index.js";

export type InitialImageFixture = {
  id?: string;
  chapterId: string;
  filename: string;
  storageKey: string;
  extension: string;
  contentType: string;
  sizeBytes: number;
  sortOrder: number;
  checksum: string;
};

export async function insertImagesWithInitialVersions(
  db: NodeProxDatabase,
  fixtures: readonly InitialImageFixture[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const prepared = fixtures.map((fixture) => ({
      ...fixture,
      id: fixture.id ?? randomUUID(),
      versionId: randomUUID(),
    }));
    await tx.insert(images).values(
      prepared.map(({ versionId, ...fixture }) => ({
        ...fixture,
        currentVersionId: versionId,
      })),
    );
    await tx.insert(imageVersions).values(
      prepared.map(({ versionId, sortOrder: _sortOrder, ...fixture }) => ({
        id: versionId,
        imageId: fixture.id,
        version: 1,
        physicalFilename: fixture.filename,
        storageKey: fixture.storageKey,
        extension: fixture.extension,
        contentType: fixture.contentType,
        sizeBytes: fixture.sizeBytes,
        checksum: fixture.checksum,
      })),
    );
  });
}
