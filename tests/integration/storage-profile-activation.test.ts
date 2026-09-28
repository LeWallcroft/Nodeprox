import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type { ChapterPermissionService } from "../../apps/api/src/modules/chapters/application/services/chapter-permission.service.js";
import type {
  UploadAuditPort,
  UploadLifecycleBoundaryPort,
  UploadRepositoryPort,
} from "../../apps/api/src/modules/uploads/application/ports/upload.ports.js";
import { ChapterUploadService } from "../../apps/api/src/modules/uploads/application/services/chapter-upload.service.js";
import { DrizzleStorageProfileReadinessRepository } from "../../apps/api/src/modules/storage-profiles/infrastructure/persistence/drizzle/storage-profile-readiness.repository.js";
import { DrizzlePublicMediaOriginResolver } from "../../apps/api/src/modules/storage-profiles/infrastructure/persistence/drizzle/public-media-origin.resolver.js";
import { REQUIRED_STORAGE_PROFILE_CHECKS } from "../../apps/api/src/modules/storage-profiles/domain/storage-profile-readiness.js";
import { LEGACY_STORAGE_PROFILE_ID } from "../../apps/api/src/modules/storage-profiles/domain/storage-profile.js";
import { createDatabase } from "../../database/client.js";
import { DrizzleStorageProfileRuntimeRepository } from "../../database/storage-profile-runtime.js";
import {
  auditLogs,
  images,
  storageProfileChecks,
  storageProfiles,
  users,
} from "../../database/schema/index.js";
import { createReplacementChapter } from "./helpers/chapter-replacement-fixture.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const profileId = randomUUID();
const actorId = randomUUID();
const hostname = `managed-${profileId.slice(0, 8)}.nodeprox.org`;
const repository = new DrizzleStorageProfileReadinessRepository(database.db);
const runtime = new DrizzleStorageProfileRuntimeRepository(database.db);

beforeAll(async () => {
  await database.db.insert(users).values({
    id: actorId,
    email: `storage-activation-${actorId}@example.test`,
    passwordHash: "not-used",
    role: "admin",
    status: "active",
  });
  await database.db.insert(storageProfiles).values({
    id: profileId,
    provider: "b2",
    source: "managed",
    status: "ready",
    name: "Managed activation fixture",
    publicHostnameLabel: `managed-${profileId.slice(0, 8)}`,
    publicHostname: hostname,
    b2BucketId: "bucket-id",
    b2DownloadHost: "f000.backblazeb2.com",
    dnsRecordId: "dns-id",
    transformRuleId: "transform-id",
    cacheRuleId: "cache-id",
    cloudflareProvisioningStatus: "verified",
  });
  await database.db.insert(storageProfileChecks).values(
    REQUIRED_STORAGE_PROFILE_CHECKS.map((checkType) => ({
      profileId,
      checkType,
      status: "verified" as const,
      verifiedAt: new Date(),
    })),
  );
});

afterAll(async () => {
  try {
    if (
      (await runtime.getActiveStorageProfileId()) !== LEGACY_STORAGE_PROFILE_ID
    )
      await repository.activate(LEGACY_STORAGE_PROFILE_ID, actorId);
    await database.db.delete(auditLogs).where(eq(auditLogs.actorId, actorId));
    await database.db
      .delete(storageProfiles)
      .where(eq(storageProfiles.id, profileId));
    await database.db.delete(users).where(eq(users.id, actorId));
  } finally {
    await database.sql.end();
  }
});

describe("managed StorageProfile activation", () => {
  it("requires all checks and performs a DB-only atomic active cutover", async () => {
    const [missing] = await database.db
      .delete(storageProfileChecks)
      .where(
        and(
          eq(storageProfileChecks.profileId, profileId),
          eq(storageProfileChecks.checkType, "b2_browser_upload"),
        ),
      )
      .returning();
    if (!missing) throw new Error("activation-fixture-check-missing");
    await expect(repository.activate(profileId, actorId)).rejects.toThrow(
      "storage-profile-activation-conflict",
    );
    expect(await runtime.getActiveStorageProfileId()).toBe(
      LEGACY_STORAGE_PROFILE_ID,
    );
    await database.db.insert(storageProfileChecks).values({
      profileId,
      checkType: "b2_browser_upload",
      status: "verified",
      verifiedAt: new Date(),
    });
    const historical = await createReplacementChapter(database.db, 1);
    await repository.activate(profileId, actorId);
    expect(await runtime.getActiveStorageProfileId()).toBe(profileId);
    const createPending = vi.fn(
      async (input: Parameters<UploadRepositoryPort["createPending"]>[0]) => ({
        ...input,
        etag: null,
        status: "pending" as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
    const transfer = {
      initiate: vi.fn(async () => ({
        mode: "single" as const,
        method: "PUT" as const,
        url: "https://s3.example.test/signed",
        headers: {},
        expiresAt: new Date().toISOString(),
      })),
    };
    const upload = new ChapterUploadService(
      {
        check: vi.fn(async () => ({
          allowed: true,
          reason: "role",
          seriesId: randomUUID(),
        })),
      } as unknown as ChapterPermissionService,
      { createPending } as unknown as UploadRepositoryPort,
      {} as UploadLifecycleBoundaryPort,
      {
        uploadTransferFor: vi.fn(async () => transfer),
      } as unknown as StorageExecutionResolver,
      runtime,
      { append: vi.fn(async () => {}) } as UploadAuditPort,
      100_000,
    );
    await upload.initiate({
      context: { userId: actorId, sessionId: randomUUID() },
      chapterId: randomUUID(),
      filename: "chapter.zip",
      contentType: "application/zip",
      sizeBytes: 12,
    });
    expect(createPending).toHaveBeenCalledWith(
      expect.objectContaining({ storageProfileId: profileId }),
    );
    const [historicalImage] = await database.db
      .select({ storageProfileId: images.storageProfileId })
      .from(images)
      .where(eq(images.id, historical.imageIds[0] as string));
    expect(historicalImage?.storageProfileId).toBe(LEGACY_STORAGE_PROFILE_ID);
    const [legacy] = await database.db
      .select({ status: storageProfiles.status })
      .from(storageProfiles)
      .where(eq(storageProfiles.id, LEGACY_STORAGE_PROFILE_ID));
    expect(legacy?.status).toBe("retired");
    const origin = new DrizzlePublicMediaOriginResolver(
      database.db,
      "http://localhost:9000",
      true,
    );
    expect(await origin.originFor(profileId)).toBe(`https://${hostname}`);
    expect(await origin.originFor(LEGACY_STORAGE_PROFILE_ID)).toBe(
      "https://media.nodeprox.org",
    );
  });

  it("reactivates legacy without changing historical managed media resolution", async () => {
    await repository.activate(LEGACY_STORAGE_PROFILE_ID, actorId);
    expect(await runtime.getActiveStorageProfileId()).toBe(
      LEGACY_STORAGE_PROFILE_ID,
    );
    const [managed] = await database.db
      .select({ status: storageProfiles.status })
      .from(storageProfiles)
      .where(eq(storageProfiles.id, profileId));
    expect(managed?.status).toBe("retired");
    expect(
      await new DrizzlePublicMediaOriginResolver(
        database.db,
        "http://localhost:9000",
        true,
      ).originFor(profileId),
    ).toBe(`https://${hostname}`);
    await repository.activate(profileId, actorId);
    expect(await runtime.getActiveStorageProfileId()).toBe(profileId);
    await repository.activate(LEGACY_STORAGE_PROFILE_ID, actorId);
  });
});
