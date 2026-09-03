import { inArray } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { DrizzleOverviewReadRepository } from "../../apps/api/src/modules/overview/infrastructure/persistence/drizzle/drizzle-overview-read.repository.js";
import { createDatabase } from "../../database/client.js";
import {
  auditLogs,
  chapters,
  series,
  users,
} from "../../database/schema/index.js";
import { insertImagesWithInitialVersions } from "./helpers/image-fixture.js";

const fixedNow = new Date("2026-08-29T12:00:00.000Z");
const createdUserIds: string[] = [];
let postgresContainer: StartedPostgreSqlContainer;
let database: ReturnType<typeof createDatabase>;

type SeedContext = {
  userId: string;
};

async function createUser(
  status: "active" | "pending" | "suspended",
  discordUsername?: string | null,
) {
  const id = randomUUID();
  createdUserIds.push(id);
  await database.db.insert(users).values({
    id,
    email: `overview-${id}@example.com`,
    passwordHash: "not-used-by-overview-tests",
    status,
    role: "uploader",
    ...(discordUsername === undefined ? {} : { discordUsername }),
  });
  return id;
}

async function createSeries(
  context: SeedContext,
  createdAt: Date,
  title = "Overview series",
) {
  const id = randomUUID();
  await database.db.insert(series).values({
    id,
    title,
    slug: `overview-${id}`,
    createdBy: context.userId,
    createdAt,
    updatedAt: createdAt,
  });
  return id;
}

async function createChapter(
  context: SeedContext,
  seriesId: string,
  createdAt: Date,
  chapterNumber: number,
) {
  const id = randomUUID();
  await database.db.insert(chapters).values({
    id,
    seriesId,
    chapterNumber,
    publicKey: String(chapterNumber),
    createdBy: context.userId,
    createdAt,
    updatedAt: createdAt,
  });
  return id;
}

async function cleanup() {
  if (createdUserIds.length === 0) return;

  await database.db
    .delete(auditLogs)
    .where(inArray(auditLogs.actorId, createdUserIds));

  await database.db
    .delete(chapters)
    .where(inArray(chapters.createdBy, createdUserIds));
  await database.db
    .delete(series)
    .where(inArray(series.createdBy, createdUserIds));
  await database.db.delete(users).where(inArray(users.id, createdUserIds));
  createdUserIds.length = 0;
}

beforeAll(async () => {
  postgresContainer = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("nodeprox")
    .withUsername("nodeprox")
    .withPassword("nodeprox")
    .start();
  database = createDatabase(postgresContainer.getConnectionUri());
  await migrate(database.db, { migrationsFolder: "database/migrations" });
});

beforeEach(cleanup);
afterEach(cleanup);
afterAll(async () => {
  await database.sql.end();
  await postgresContainer.stop();
});

describe("DrizzleOverviewReadRepository", () => {
  it("returns exact totals and counts only active users", async () => {
    const activeUserId = await createUser("active");
    await createUser("pending");
    await createUser("suspended");
    const context = { userId: activeUserId };
    const firstSeriesId = await createSeries(context, fixedNow, "First");
    const secondSeriesId = await createSeries(context, fixedNow, "Second");
    const firstChapterId = await createChapter(
      context,
      firstSeriesId,
      fixedNow,
      1,
    );
    const secondChapterId = await createChapter(
      context,
      secondSeriesId,
      fixedNow,
      1,
    );

    await insertImagesWithInitialVersions(database.db, [
      {
        id: randomUUID(),
        chapterId: firstChapterId,
        filename: "01.jpg",
        storageKey: "Media/overview/1/01.jpg",
        extension: "jpg",
        contentType: "image/jpeg",
        sizeBytes: 1,
        sortOrder: 1,
        checksum: "first-image",
      },
      {
        id: randomUUID(),
        chapterId: secondChapterId,
        filename: "01.webp",
        storageKey: "Media/overview/2/01.webp",
        extension: "webp",
        contentType: "image/webp",
        sizeBytes: 1,
        sortOrder: 1,
        checksum: "second-image",
      },
    ]);

    const repository = new DrizzleOverviewReadRepository(
      database.db,
      () => fixedNow,
    );

    await expect(repository.getTotals()).resolves.toEqual({
      series: 2,
      chapters: 2,
      images: 2,
      activeUsers: 1,
    });
  });

  it("returns zeros for an empty database", async () => {
    const repository = new DrizzleOverviewReadRepository(
      database.db,
      () => fixedNow,
    );

    await expect(repository.getTotals()).resolves.toEqual({
      series: 0,
      chapters: 0,
      images: 0,
      activeUsers: 0,
    });
  });

  it("groups UTC activity across seven consecutive days and zero-fills gaps", async () => {
    const context = { userId: await createUser("active") };
    const start = new Date("2026-08-23T00:00:00.000Z");
    const firstSeriesId = await createSeries(context, start, "Start");
    await createSeries(context, new Date("2026-08-28T23:59:59.000Z"), "Late");
    const todaySeriesId = await createSeries(
      context,
      new Date("2026-08-29T00:00:01.000Z"),
      "Today",
    );
    await createSeries(
      context,
      new Date("2026-08-28T10:00:00.000Z"),
      "Same day",
    );
    await createSeries(context, new Date("2026-08-22T23:59:59.000Z"), "Old");
    await createSeries(context, new Date("2026-08-29T12:00:01.000Z"), "Future");

    await createChapter(context, firstSeriesId, start, 1);
    await createChapter(
      context,
      todaySeriesId,
      new Date("2026-08-29T00:00:01.000Z"),
      1,
    );
    await createChapter(
      context,
      todaySeriesId,
      new Date("2026-08-29T10:00:00.000Z"),
      2,
    );
    await createChapter(
      context,
      todaySeriesId,
      new Date("2026-08-22T23:59:59.000Z"),
      3,
    );
    await createChapter(
      context,
      todaySeriesId,
      new Date("2026-08-29T12:00:01.000Z"),
      4,
    );

    const repository = new DrizzleOverviewReadRepository(
      database.db,
      () => fixedNow,
    );

    await expect(repository.getActivity7d()).resolves.toEqual([
      { date: "2026-08-23", series: 1, chapters: 1 },
      { date: "2026-08-24", series: 0, chapters: 0 },
      { date: "2026-08-25", series: 0, chapters: 0 },
      { date: "2026-08-26", series: 0, chapters: 0 },
      { date: "2026-08-27", series: 0, chapters: 0 },
      { date: "2026-08-28", series: 2, chapters: 0 },
      { date: "2026-08-29", series: 1, chapters: 2 },
    ]);
  });

  it("projects recent human activity in descending order with safe actor labels", async () => {
    const discordActorId = await createUser("active", "overview-discord");
    const emailActorId = await createUser("active", null);
    await database.db.insert(auditLogs).values([
      {
        id: randomUUID(),
        actorId: discordActorId,
        action: "settings.updated",
        resourceType: "product-settings",
        metadata: { sensitive: "must-not-be-projected" },
        createdAt: new Date("2026-08-29T11:00:00.000Z"),
      },
      {
        id: randomUUID(),
        actorId: emailActorId,
        action: "chapter.permission.granted",
        resourceType: "chapter",
        metadata: { result: "granted" },
        createdAt: new Date("2026-08-29T11:30:00.000Z"),
      },
      {
        id: randomUUID(),
        actorId: discordActorId,
        action: "chapter.upload.expired",
        resourceType: "chapter",
        createdAt: new Date("2026-08-29T11:45:00.000Z"),
      },
      {
        id: randomUUID(),
        action: "worker.processing.completed",
        resourceType: "chapter",
        createdAt: new Date("2026-08-29T11:50:00.000Z"),
      },
    ]);
    const repository = new DrizzleOverviewReadRepository(
      database.db,
      () => fixedNow,
    );

    const activity = await repository.getRecentActivity(5);

    expect(activity).toHaveLength(2);
    expect(activity).toMatchObject([
      {
        actor: {
          id: emailActorId,
          label: `overview-${emailActorId}@example.com`,
        },
        action: "chapter.permission.granted",
        resourceType: "chapter",
        resourceLabel: null,
        occurredAt: "2026-08-29T11:30:00.000Z",
      },
      {
        actor: { id: discordActorId, label: "overview-discord" },
        action: "settings.updated",
        resourceType: "product-settings",
        resourceLabel: null,
        occurredAt: "2026-08-29T11:00:00.000Z",
      },
    ]);
    expect(activity[0]).not.toHaveProperty("metadata");
  });

  it("caps recent activity at the safe limit and returns an empty list for zero", async () => {
    const actorId = await createUser("active");
    await database.db.insert(auditLogs).values(
      Array.from({ length: 51 }, (_, index) => ({
        id: randomUUID(),
        actorId,
        action: "settings.updated",
        resourceType: "product-settings",
        createdAt: new Date(fixedNow.getTime() - index * 1000),
      })),
    );
    const repository = new DrizzleOverviewReadRepository(
      database.db,
      () => fixedNow,
    );

    await expect(repository.getRecentActivity(999)).resolves.toHaveLength(50);
    await expect(repository.getRecentActivity(0)).resolves.toEqual([]);
  });

  it("sums persisted final image sizes without inventing a storage quota", async () => {
    const context = { userId: await createUser("active") };
    const seriesId = await createSeries(context, fixedNow);
    const chapterId = await createChapter(context, seriesId, fixedNow, 1);
    await insertImagesWithInitialVersions(database.db, [
      {
        id: randomUUID(),
        chapterId,
        filename: "01.jpg",
        storageKey: "Media/overview/1/01.jpg",
        extension: "jpg",
        contentType: "image/jpeg",
        sizeBytes: 1024,
        sortOrder: 1,
        checksum: "storage-one",
      },
      {
        id: randomUUID(),
        chapterId,
        filename: "02.webp",
        storageKey: "Media/overview/1/02.webp",
        extension: "webp",
        contentType: "image/webp",
        sizeBytes: 2048,
        sortOrder: 2,
        checksum: "storage-two",
      },
    ]);
    const repository = new DrizzleOverviewReadRepository(
      database.db,
      () => fixedNow,
    );

    await expect(repository.getStorageUsage()).resolves.toEqual({
      usedBytes: 3072,
      quotaBytes: null,
      source: "database",
    });
  });

  it("reports zero database storage usage for an empty database", async () => {
    const repository = new DrizzleOverviewReadRepository(
      database.db,
      () => fixedNow,
    );

    await expect(repository.getStorageUsage()).resolves.toEqual({
      usedBytes: 0,
      quotaBytes: null,
      source: "database",
    });
  });
});
