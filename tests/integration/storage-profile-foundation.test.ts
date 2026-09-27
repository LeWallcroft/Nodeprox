import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { LEGACY_STORAGE_PROFILE_ID } from "../../apps/api/src/modules/storage-profiles/domain/storage-profile.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
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

  it("rejects Gestor direct HTTP access", async () => {
    const result = await app.inject({
      method: "GET",
      url: "/admin/storage/profiles",
      headers: { cookie: gestorCookie },
    });
    expect(result.statusCode).toBe(403);
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

  it("returns 503 and preserves ciphertext/version when the cipher is unavailable", async () => {
    const [before] = await database.db
      .select()
      .from(storageProfiles)
      .where(eq(storageProfiles.id, profileId));
    const withoutCipher = buildApp(
      { logger: false },
      {
        database: database.db,
        storageProfileConfig: { STORAGE_RESERVED_HOSTNAME_LABELS: "api,www" },
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
