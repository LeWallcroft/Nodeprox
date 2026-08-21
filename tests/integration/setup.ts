import { GenericContainer, type StartedTestContainer } from "testcontainers";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { createDatabase } from "../../database/client.js";

declare module "vitest" {
  interface ProvidedContext {
    infrastructure: IntegrationInfrastructure;
  }
}

export interface IntegrationInfrastructure {
  databaseUrl: string;
  redisUrl: string;
}

let postgresContainer: StartedPostgreSqlContainer;
let redisContainer: StartedTestContainer;

export default async function setup({
  provide,
}: {
  provide: (key: "infrastructure", value: IntegrationInfrastructure) => void;
}): Promise<() => Promise<void>> {
  postgresContainer = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("nodeprox")
    .withUsername("nodeprox")
    .withPassword("nodeprox")
    .start();

  redisContainer = await new GenericContainer("redis:7-alpine")
    .withExposedPorts(6379)
    .start();

  const database = createDatabase(postgresContainer.getConnectionUri());
  await migrate(database.db, { migrationsFolder: "database/migrations" });
  await database.sql.end();

  provide("infrastructure", {
    databaseUrl: postgresContainer.getConnectionUri(),
    redisUrl: `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(6379)}`,
  });

  return async () => {
    await Promise.all([postgresContainer.stop(), redisContainer.stop()]);
  };
}
