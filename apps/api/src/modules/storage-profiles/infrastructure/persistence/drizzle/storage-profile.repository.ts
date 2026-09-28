import { and, eq, sql } from "drizzle-orm";
import type { NodeProxDatabase } from "../../../../../../../../database/client.js";
import {
  auditLogs,
  storageProfiles,
} from "../../../../../../../../database/schema/index.js";
import type { StorageProfileRepository } from "../../../application/ports/storage-profile.ports.js";
import { StorageProfileConflictError } from "../../../application/storage-profile.service.js";
import type { StorageProfile } from "../../../domain/storage-profile.js";

export class DrizzleStorageProfileRepository
  implements StorageProfileRepository
{
  constructor(private readonly db: NodeProxDatabase) {}

  async list(): Promise<StorageProfile[]> {
    return this.db
      .select()
      .from(storageProfiles)
      .orderBy(storageProfiles.createdAt);
  }

  async findById(id: string): Promise<StorageProfile | null> {
    return (
      (
        await this.db
          .select()
          .from(storageProfiles)
          .where(eq(storageProfiles.id, id))
          .limit(1)
      )[0] ?? null
    );
  }

  async createDraft(
    input: Parameters<StorageProfileRepository["createDraft"]>[0],
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        const [profile] = await tx
          .insert(storageProfiles)
          .values({
            provider: "b2",
            source: "managed",
            status: "draft",
            name: input.name,
            publicHostnameLabel: input.publicHostnameLabel,
            publicHostname: input.publicHostname,
            b2Endpoint: input.b2Endpoint,
            b2Region: input.b2Region,
            b2Bucket: input.b2Bucket,
            b2KeyId: input.b2KeyId,
            encryptedApplicationKey: input.encryptedApplicationKey,
            credentialVersion: input.encryptedApplicationKey === null ? 0 : 1,
          })
          .returning();
        if (!profile) throw new Error("storage-profile-insert-failed");
        await tx.insert(auditLogs).values({
          actorId: input.actorId,
          action: "storage.profile.draft.created",
          resourceType: "storage-profile",
          resourceId: profile.id,
          result: "success",
          ...(input.requestId ? { requestId: input.requestId } : {}),
          metadata: {
            name: profile.name,
            publicHostnameLabel: profile.publicHostnameLabel,
          },
        });
        return profile;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new StorageProfileConflictError();
      throw error;
    }
  }

  async updateDraft(
    input: Parameters<StorageProfileRepository["updateDraft"]>[0],
  ) {
    try {
      return await this.db.transaction(async (tx) => {
        const [profile] = await tx
          .update(storageProfiles)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.publicHostnameLabel !== undefined
              ? { publicHostnameLabel: input.publicHostnameLabel }
              : {}),
            ...(input.publicHostname !== undefined
              ? { publicHostname: input.publicHostname }
              : {}),
            ...(input.b2Endpoint !== undefined
              ? { b2Endpoint: input.b2Endpoint }
              : {}),
            ...(input.b2Region !== undefined
              ? { b2Region: input.b2Region }
              : {}),
            ...(input.b2Bucket !== undefined
              ? { b2Bucket: input.b2Bucket }
              : {}),
            ...(input.b2KeyId !== undefined ? { b2KeyId: input.b2KeyId } : {}),
            ...(input.encryptedApplicationKey !== undefined
              ? {
                  encryptedApplicationKey: input.encryptedApplicationKey,
                  credentialVersion: sql`${storageProfiles.credentialVersion} + 1`,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(storageProfiles.id, input.id),
              eq(storageProfiles.source, "managed"),
              eq(storageProfiles.status, "draft"),
              ...(Object.keys(input).some(
                (key) => !["id", "actorId", "requestId", "name"].includes(key),
              )
                ? [
                    sql`${storageProfiles.cloudflareProvisioningStatus} <> 'verified'`,
                  ]
                : []),
            ),
          )
          .returning();
        if (!profile) return null;
        await tx.insert(auditLogs).values({
          actorId: input.actorId,
          action: "storage.profile.draft.updated",
          resourceType: "storage-profile",
          resourceId: profile.id,
          result: "success",
          ...(input.requestId ? { requestId: input.requestId } : {}),
          metadata: {
            fields: [
              "name",
              "publicHostnameLabel",
              "b2Endpoint",
              "b2Region",
              "b2Bucket",
              "b2KeyId",
            ]
              .filter((key) => input[key as keyof typeof input] !== undefined)
              .concat(
                input.encryptedApplicationKey !== undefined
                  ? ["b2Credentials"]
                  : [],
              ),
          },
        });
        return profile;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new StorageProfileConflictError();
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}
