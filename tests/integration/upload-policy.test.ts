import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import { auditLogs, users } from "../../database/schema/index.js";

const infrastructure = inject("infrastructure");
const database = createDatabase(infrastructure.databaseUrl);
const password = "upload-policy-integration-password";
const app = buildApp(
  { logger: false },
  { database: database.db, secureCookie: false },
);
const testUsers = (["uploader", "gestor", "admin"] as const).map((role) => ({
  id: randomUUID(),
  email: `upload-policy-${role}-${randomUUID()}@example.com`,
  role,
}));

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

beforeAll(async () => {
  const hasher = new Argon2PasswordHasher();
  await database.db.insert(users).values(
    await Promise.all(
      testUsers.map(async (user) => ({
        ...user,
        passwordHash: await hasher.hash(password),
        status: "active" as const,
      })),
    ),
  );
});

afterAll(async () => {
  for (const user of testUsers) {
    await database.db.delete(auditLogs).where(eq(auditLogs.actorId, user.id));
    await database.db.delete(users).where(eq(users.id, user.id));
  }
  await app.close();
  await database.sql.end();
});

describe("GET /me/upload-policy", () => {
  it.each(testUsers)(
    "is available to the $role role with a safe policy",
    async (user) => {
      const login = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { email: user.email, password },
      });
      expect(login.statusCode).toBe(204);

      const response = await app.inject({
        method: "GET",
        url: "/me/upload-policy",
        headers: { cookie: cookieValue(login.headers["set-cookie"]) },
      });

      expect(response.statusCode).toBe(200);
      const policy = response.json();
      expect(Object.keys(policy).sort()).toEqual([
        "images",
        "transfer",
        "warnings",
        "zip",
      ]);
      expect(policy.zip).toMatchObject({
        layouts: ["flat", "single-wrapper"],
      });
      expect(policy.images.filenameRule).toBe("two-digit-sequence");
      expect(policy.transfer.maxConcurrentUploads).toBeGreaterThan(0);
      expect(JSON.stringify(policy)).not.toMatch(
        /credential|secret|token|redis|filesystem|path|provider/i,
      );
    },
  );

  it("requires an authenticated session", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/me/upload-policy",
    });
    expect(response.statusCode).toBe(401);
  });
});
