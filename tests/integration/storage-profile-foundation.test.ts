import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import type { B2BucketAdministrationPort } from "../../apps/api/src/modules/storage-profiles/application/ports/b2-administration.ports.js";
import type {
  CloudflareDnsPort,
  CloudflareRulesPort,
} from "../../apps/api/src/modules/storage-profiles/application/ports/cloudflare.ports.js";
import { LEGACY_STORAGE_PROFILE_ID } from "../../apps/api/src/modules/storage-profiles/domain/storage-profile.js";
import { DrizzleStorageProfileReadinessRepository } from "../../apps/api/src/modules/storage-profiles/infrastructure/persistence/drizzle/storage-profile-readiness.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  storageProfileProbeSessions,
  storageProfiles,
  users,
} from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const app = buildApp(
  { logger: false },
  {
    database: database.db,
    storageProfileConfig: {
      STORAGE_PROFILE_MASTER_KEY: Buffer.alloc(32, 7).toString("base64"),
      STORAGE_RESERVED_HOSTNAME_LABELS: "api,www",
      STORAGE_BROWSER_UPLOAD_ORIGINS: "http://localhost:3000",
      STORAGE_MANAGED_PROFILE_OPERATIONS_ENABLED: false,
    },
  },
);
const password = "storage-profile-test-password";
const adminId = randomUUID();
const gestorId = randomUUID();
const label = `m${randomUUID().replaceAll("-", "").slice(0, 15)}`;
let adminCookie = "";
let gestorCookie = "";
let profileId = "";

async function login(email: string): Promise<string> {
  const result = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(result.statusCode).toBe(204);
  const header = result.headers["set-cookie"];
  const cookie = Array.isArray(header) ? header[0] : header;
  if (!cookie) throw new Error("session-cookie-missing");
  return cookie;
}

beforeAll(async () => {
  const hash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: adminId,
      email: `storage-admin-${adminId}@example.com`,
      passwordHash: hash,
      status: "active",
      role: "admin",
    },
    {
      id: gestorId,
      email: `storage-gestor-${gestorId}@example.com`,
      passwordHash: hash,
      status: "active",
      role: "gestor",
    },
  ]);
  adminCookie = await login(`storage-admin-${adminId}@example.com`);
  gestorCookie = await login(`storage-gestor-${gestorId}@example.com`);
});

afterAll(async () => {
  await app.close();
  await database.sql.end();
});

describe("StorageProfile foundation", () => {
  it("seeds one deterministic legacy profile with no B2 credentials in DB", async () => {
    const [legacy] = await database.db
      .select()
      .from(storageProfiles)
      .where(eq(storageProfiles.id, LEGACY_STORAGE_PROFILE_ID));
    expect(legacy).toMatchObject({
      id: LEGACY_STORAGE_PROFILE_ID,
      provider: "b2",
      source: "env",
      status: "active",
      credentialVersion: 0,
      publicHostname: "media.nodeprox.org",
      b2Endpoint: null,
      b2Region: null,
      b2Bucket: null,
      b2KeyId: null,
      encryptedApplicationKey: null,
    });
  });

  it("persists expired probe outcomes and makes completion idempotent", async () => {
    const repository = new DrizzleStorageProfileReadinessRepository(
      database.db,
    );
    const expiredId = randomUUID();
    const completedId = randomUUID();
    const session = (id: string, expiresAt: Date) => ({
      id,
      profileId: LEGACY_STORAGE_PROFILE_ID,
      storageKey: `uploads/nodeprox-browser-probe/${id}.txt`,
      expectedSha256: "a".repeat(64),
      expectedSizeBytes: 1,
      contentType: "text/plain",
      expiresAt,
    });
    try {
      await repository.createProbeSession(
        session(expiredId, new Date(Date.now() - 1_000)),
      );
      await repository.createProbeSession(
        session(completedId, new Date(Date.now() + 60_000)),
      );
      await expect(
        repository.expireProbeSessions(LEGACY_STORAGE_PROFILE_ID),
      ).resolves.toEqual([
        expect.objectContaining({
          id: expiredId,
          storageKey: `uploads/nodeprox-browser-probe/${expiredId}.txt`,
        }),
      ]);
      const [expired] = await database.db
        .select({ status: storageProfileProbeSessions.status })
        .from(storageProfileProbeSessions)
        .where(eq(storageProfileProbeSessions.id, expiredId));
      expect(expired?.status).toBe("expired");

      await expect(
        repository.claimProbeSession(LEGACY_STORAGE_PROFILE_ID, completedId),
      ).resolves.toMatchObject({ state: "claimed" });
      await repository.completeProbeSession(completedId, "completed");
      await expect(
        repository.claimProbeSession(LEGACY_STORAGE_PROFILE_ID, completedId),
      ).resolves.toMatchObject({ state: "completed" });
    } finally {
      await database.db
        .delete(storageProfileProbeSessions)
        .where(eq(storageProfileProbeSessions.id, expiredId));
      await database.db
        .delete(storageProfileProbeSessions)
        .where(eq(storageProfileProbeSessions.id, completedId));
    }
  });

  it("rejects Gestor direct HTTP access", async () => {
    const result = await app.inject({
      method: "GET",
      url: "/admin/storage/profiles",
      headers: { cookie: gestorCookie },
    });
    expect(result.statusCode).toBe(403);
  });

  it("requires storage-management authority and gates provider operations without network calls", async () => {
    const id = LEGACY_STORAGE_PROFILE_ID;
    const routes = [
      ["GET", `/admin/storage/profiles/${id}/readiness`],
      ["POST", `/admin/storage/profiles/${id}/b2/provision`],
      ["POST", `/admin/storage/profiles/${id}/browser-probe/start`],
      ["POST", `/admin/storage/profiles/${id}/cloudflare/provision`],
      ["POST", `/admin/storage/profiles/${id}/activate`],
    ] as const;
    for (const [method, url] of routes) {
      expect(
        (await app.inject({ method, url, headers: { cookie: gestorCookie } }))
          .statusCode,
      ).toBe(403);
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
    for (const url of [
      routes[1][1],
      routes[2][1],
      routes[3][1],
      routes[4][1],
    ]) {
      const result = await app.inject({
        method: "POST",
        url,
        headers: { cookie: adminCookie },
      });
      expect(result.statusCode).toBe(503);
      expect(result.body).toContain("storage-managed-operations-disabled");
    }
  });

  it("keeps local profile operations available and avoids provider adapters while disabled", async () => {
    const b2 = {
      validateCredentials: vi.fn(),
      inspect: vi.fn(),
      ensureNodeProxCors: vi.fn(),
      ensureNodeProxLifecycle: vi.fn(),
    } as unknown as B2BucketAdministrationPort;
    const dns = {
      inspectHostname: vi.fn(),
      createManagedCname: vi.fn(),
      updateManagedCname: vi.fn(),
    } as unknown as CloudflareDnsPort;
    const rules = {
      inspect: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    } as unknown as CloudflareRulesPort;
    const disabledApp = buildApp(
      { logger: false },
      {
        database: database.db,
        storageProfileConfig: {
          STORAGE_PROFILE_MASTER_KEY: Buffer.alloc(32, 8).toString("base64"),
          STORAGE_RESERVED_HOSTNAME_LABELS: "api,www",
          STORAGE_BROWSER_UPLOAD_ORIGINS: "http://localhost:3000",
          STORAGE_MANAGED_PROFILE_OPERATIONS_ENABLED: false,
          CLOUDFLARE_ZONE_ID: "test-zone",
          CLOUDFLARE_PROVISIONING_API_TOKEN: "test-provision-token",
          CLOUDFLARE_CACHE_RULES_API_TOKEN: "test-cache-token",
        },
        storageProfileProviders: { b2, dns, transform: rules, cache: rules },
      },
    );
    const draftLabel = `g${randomUUID().replaceAll("-", "").slice(0, 14)}`;
    try {
      const created = await disabledApp.inject({
        method: "POST",
        url: "/admin/storage/profiles",
        headers: { cookie: adminCookie },
        payload: { name: "Gate test", publicHostnameLabel: draftLabel },
      });
      expect(created.statusCode).toBe(201);
      const id = created.json<{ id: string }>().id;
      const edited = await disabledApp.inject({
        method: "PATCH",
        url: `/admin/storage/profiles/${id}`,
        headers: { cookie: adminCookie },
        payload: { name: "Gate test edited" },
      });
      expect(edited.statusCode).toBe(200);
      expect(
        (
          await disabledApp.inject({
            method: "GET",
            url: `/admin/storage/profiles/${id}/readiness`,
            headers: { cookie: adminCookie },
          })
        ).statusCode,
      ).toBe(200);

      const credentials = await disabledApp.inject({
        method: "POST",
        url: `/admin/storage/profiles/${id}/credentials`,
        headers: { cookie: adminCookie },
        payload: { b2KeyId: "never-validated", b2ApplicationKey: "secret" },
      });
      expect(credentials.statusCode).toBe(503);
      expect(credentials.body).toContain("storage-managed-operations-disabled");
      const [unchanged] = await database.db
        .select({
          b2KeyId: storageProfiles.b2KeyId,
          encryptedApplicationKey: storageProfiles.encryptedApplicationKey,
          credentialVersion: storageProfiles.credentialVersion,
        })
        .from(storageProfiles)
        .where(eq(storageProfiles.id, id));
      expect(unchanged).toMatchObject({
        b2KeyId: null,
        encryptedApplicationKey: null,
        credentialVersion: 0,
      });
      const cloudflareStatus = await disabledApp.inject({
        method: "GET",
        url: `/admin/storage/profiles/${id}/cloudflare/status`,
        headers: { cookie: adminCookie },
      });
      expect(cloudflareStatus.statusCode).toBe(200);
      expect(cloudflareStatus.json()).toMatchObject({
        providerInspectionAvailable: false,
        hostname: `${draftLabel}.nodeprox.org`,
      });
      const gatedProviderRoutes = [
        ["POST", `/admin/storage/profiles/${id}/b2/provision`],
        ["POST", `/admin/storage/profiles/${id}/b2/recheck`],
        ["POST", `/admin/storage/profiles/${id}/browser-probe/start`],
        ["POST", `/admin/storage/profiles/${id}/cloudflare/provision`],
        ["POST", `/admin/storage/profiles/${id}/cloudflare/recheck`],
        ["POST", `/admin/storage/profiles/${id}/activate`],
      ] as const;
      for (const [method, url] of gatedProviderRoutes) {
        const response = await disabledApp.inject({
          method,
          url,
          headers: { cookie: adminCookie },
        });
        expect(response.statusCode).toBe(503);
        expect(response.body).toContain("storage-managed-operations-disabled");
      }
      expect(b2.validateCredentials).not.toHaveBeenCalled();
      expect(b2.inspect).not.toHaveBeenCalled();
      expect(b2.ensureNodeProxCors).not.toHaveBeenCalled();
      expect(b2.ensureNodeProxLifecycle).not.toHaveBeenCalled();
      expect(dns.inspectHostname).not.toHaveBeenCalled();
      expect(rules.inspect).not.toHaveBeenCalled();
    } finally {
      await disabledApp.close();
      await database.db
        .delete(storageProfiles)
        .where(eq(storageProfiles.publicHostnameLabel, draftLabel));
    }
  });

  it("creates and edits a managed draft, encrypts credentials, and audits without secret", async () => {
    const secret = `private-${randomUUID()}`;
    const created = await app.inject({
      method: "POST",
      url: "/admin/storage/profiles",
      headers: { cookie: adminCookie },
      payload: {
        name: "Bucket secundario",
        publicHostnameLabel: label.toUpperCase(),
        b2Endpoint: "https://s3.example.invalid",
        b2Region: "test-region",
        b2Bucket: "test-bucket",
        b2KeyId: "test-key-id",
        b2ApplicationKey: secret,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(secret);
    expect(created.body).not.toContain("encryptedApplicationKey");
    profileId = created.json().id;
    expect(created.json()).toMatchObject({
      provider: "b2",
      source: "managed",
      status: "draft",
      credentialVersion: 1,
      publicHostnameLabel: label,
      publicHostname: `${label}.nodeprox.org`,
      credentialConfigured: true,
      publicUrlPreview: `https://${label}.nodeprox.org`,
    });
    const [stored] = await database.db
      .select()
      .from(storageProfiles)
      .where(eq(storageProfiles.id, profileId));
    expect(stored?.encryptedApplicationKey).not.toBe(secret);
    expect(stored?.encryptedApplicationKey).toMatch(/^v1:/);
    const detail = await app.inject({
      method: "GET",
      url: `/admin/storage/profiles/${profileId}`,
      headers: { cookie: adminCookie },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).not.toContain(secret);
    expect(detail.body).not.toContain("encryptedApplicationKey");
    expect(detail.json()).toMatchObject({
      b2Endpoint: "https://s3.example.invalid",
      b2Region: "test-region",
      b2Bucket: "test-bucket",
      b2KeyId: "test-key-id",
      credentialVersion: 1,
    });
    const list = await app.inject({
      method: "GET",
      url: "/admin/storage/profiles",
      headers: { cookie: adminCookie },
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(secret);
    expect(list.body).not.toContain("encryptedApplicationKey");
    expect(
      list.json().items.find((item: { id: string }) => item.id === profileId),
    ).not.toHaveProperty("b2KeyId");
    const changed = await app.inject({
      method: "PATCH",
      url: `/admin/storage/profiles/${profileId}`,
      headers: { cookie: adminCookie },
      payload: {
        name: "Bucket editado",
        b2ApplicationKey: "rotated-private-key",
      },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.body).not.toContain("rotated-private-key");
    expect(changed.json().credentialVersion).toBe(2);
    const [rotated] = await database.db
      .select()
      .from(storageProfiles)
      .where(eq(storageProfiles.id, profileId));
    expect(rotated?.credentialVersion).toBe(2);
    expect(rotated?.encryptedApplicationKey).not.toBe(
      stored?.encryptedApplicationKey,
    );
    const events = await database.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, profileId));
    expect(events.map((event) => event.action)).toEqual(
      expect.arrayContaining([
        "storage.profile.draft.created",
        "storage.profile.draft.updated",
      ]),
    );
    expect(JSON.stringify(events)).not.toContain(secret);
    expect(JSON.stringify(events)).not.toContain("rotated-private-key");
    expect(JSON.stringify(events)).not.toContain("encryptedApplicationKey");
    expect(JSON.stringify(events)).not.toContain(
      stored?.encryptedApplicationKey,
    );
    expect(
      events.find((event) => event.action === "storage.profile.draft.updated")
        ?.metadata,
    ).toMatchObject({ fields: ["name", "b2Credentials"] });
  });

  it("rejects hostname renaming after Cloudflare has been verified", async () => {
    await database.db
      .update(storageProfiles)
      .set({ cloudflareProvisioningStatus: "verified" })
      .where(eq(storageProfiles.id, profileId));
    try {
      const response = await app.inject({
        method: "PATCH",
        url: `/admin/storage/profiles/${profileId}`,
        headers: { cookie: adminCookie },
        payload: { publicHostnameLabel: `renamed-${label}` },
      });
      expect(response.statusCode).toBe(409);
      const [profile] = await database.db
        .select({ hostname: storageProfiles.publicHostname })
        .from(storageProfiles)
        .where(eq(storageProfiles.id, profileId));
      expect(profile?.hostname).toBe(`${label}.nodeprox.org`);
    } finally {
      await database.db
        .update(storageProfiles)
        .set({ cloudflareProvisioningStatus: "pending" })
        .where(eq(storageProfiles.id, profileId));
    }
  });

  it("returns 503 and preserves ciphertext/version when the cipher is unavailable", async () => {
    const [before] = await database.db
      .select()
      .from(storageProfiles)
      .where(eq(storageProfiles.id, profileId));
    const withoutCipher = buildApp(
      { logger: false },
      {
        database: database.db,
        storageProfileConfig: {
          STORAGE_RESERVED_HOSTNAME_LABELS: "api,www",
          STORAGE_BROWSER_UPLOAD_ORIGINS: "http://localhost:3000",
          STORAGE_MANAGED_PROFILE_OPERATIONS_ENABLED: true,
        },
      },
    );
    try {
      const result = await withoutCipher.inject({
        method: "PATCH",
        url: `/admin/storage/profiles/${profileId}`,
        headers: { cookie: adminCookie },
        payload: { b2ApplicationKey: "must-not-persist" },
      });
      expect(result.statusCode).toBe(503);
      expect(result.body).toContain("storage-profile-cipher-unavailable");
      const [after] = await database.db
        .select()
        .from(storageProfiles)
        .where(eq(storageProfiles.id, profileId));
      expect(after?.encryptedApplicationKey).toBe(
        before?.encryptedApplicationKey,
      );
      expect(after?.credentialVersion).toBe(before?.credentialVersion);
    } finally {
      await withoutCipher.close();
    }
  });

  it("rejects duplicate labels and protects immutable legacy", async () => {
    const duplicate = await app.inject({
      method: "POST",
      url: "/admin/storage/profiles",
      headers: { cookie: adminCookie },
      payload: { name: "Duplicate", publicHostnameLabel: label },
    });
    expect(duplicate.statusCode).toBe(409);
    const legacyEdit = await app.inject({
      method: "PATCH",
      url: `/admin/storage/profiles/${LEGACY_STORAGE_PROFILE_ID}`,
      headers: { cookie: adminCookie },
      payload: { name: "Changed" },
    });
    expect(legacyEdit.statusCode).toBe(409);
    const invalid = await app.inject({
      method: "POST",
      url: "/admin/storage/profiles",
      headers: { cookie: adminCookie },
      payload: { name: "Reserved", publicHostnameLabel: "media" },
    });
    expect(invalid.statusCode).toBe(422);
    const reserved = await app.inject({
      method: "POST",
      url: "/admin/storage/profiles",
      headers: { cookie: adminCookie },
      payload: { name: "Reserved", publicHostnameLabel: "api" },
    });
    expect(reserved.statusCode).toBe(422);
  });
});
