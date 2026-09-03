import { migrate } from "drizzle-orm/postgres-js/migrator";
import { randomUUID } from "node:crypto";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapters,
  series,
  users,
} from "../../database/schema/index.js";
import { insertImagesWithInitialVersions } from "./helpers/image-fixture.js";

const password = "overview-endpoint-password";
const adminId = randomUUID();
const uploaderId = randomUUID();
const adminEmail = `overview-admin-${adminId}@example.com`;
const uploaderEmail = `overview-uploader-${uploaderId}@example.com`;
let postgresContainer: StartedPostgreSqlContainer;
let database: ReturnType<typeof createDatabase>;
let app: ReturnType<typeof buildApp>;

function cookieValue(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) throw new Error("Expected session cookie");
  return value;
}

async function login(email: string) {
  const response = await app.inject({
    method: "POST",
    url: "/auth/login",
    payload: { email, password },
  });
  expect(response.statusCode).toBe(204);
  return cookieValue(response.headers["set-cookie"]);
}

beforeAll(async () => {
  postgresContainer = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("nodeprox")
    .withUsername("nodeprox")
    .withPassword("nodeprox")
    .start();
  database = createDatabase(postgresContainer.getConnectionUri());
  await migrate(database.db, { migrationsFolder: "database/migrations" });
  app = buildApp(
    { logger: false },
    { database: database.db, secureCookie: false },
  );
  const passwordHash = await new Argon2PasswordHasher().hash(password);
  await database.db.insert(users).values([
    {
      id: adminId,
      email: adminEmail,
      discordUsername: "overview-admin",
      passwordHash,
      status: "active",
      role: "admin",
    },
    {
      id: uploaderId,
      email: uploaderEmail,
      passwordHash,
      status: "active",
      role: "uploader",
    },
  ]);
  const seriesId = randomUUID();
  const chapterId = randomUUID();
  await database.db.insert(series).values({
    id: seriesId,
    title: "Overview endpoint series",
    slug: `overview-endpoint-${seriesId}`,
    createdBy: adminId,
  });
  await database.db.insert(chapters).values({
    id: chapterId,
    seriesId,
    chapterNumber: 1,
    publicKey: "1",
    createdBy: adminId,
  });
  await insertImagesWithInitialVersions(database.db, [
    {
      id: randomUUID(),
      chapterId,
      filename: "01.jpg",
      storageKey: "Media/overview/1/01.jpg",
      extension: "jpg",
      contentType: "image/jpeg",
      sizeBytes: 256,
      sortOrder: 1,
      checksum: "overview-endpoint-image",
    },
  ]);
  await database.db.insert(auditLogs).values({
    id: randomUUID(),
    actorId: adminId,
    action: "settings.updated",
    resourceType: "product-settings",
  });
});

afterAll(async () => {
  await app.close();
  await database.sql.end();
  await postgresContainer.stop();
});

describe("GET /overview", () => {
  it("requires a valid session", async () => {
    const response = await app.inject({ method: "GET", url: "/overview" });

    expect(response.statusCode).toBe(401);
  });

  it("returns the full administrative read model", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/overview",
      headers: { cookie: await login(adminEmail) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totals: { series: 1, chapters: 1, images: 1, activeUsers: 2 },
      system: {
        overallStatus: "operational",
        storage: { usedBytes: 256, quotaBytes: null, source: "database" },
      },
    });
    expect(response.json().recentActivity).toHaveLength(1);
    expect(response.json().system.activity7d).toHaveLength(7);
  });

  it("returns a reduced projection for non-administrative dashboard actors", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/overview",
      headers: { cookie: await login(uploaderEmail) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      totals: { series: 1, chapters: 1, images: 1, activeUsers: null },
      recentActivity: [],
      system: { storage: { source: "database" } },
    });
    expect(response.json().system.activity7d).toHaveLength(7);
  });
});
