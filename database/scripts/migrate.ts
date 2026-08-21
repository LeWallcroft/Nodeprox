import "dotenv/config";
import { loadDatabaseConfig } from "@nodeprox/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const { DATABASE_URL: connectionString } = loadDatabaseConfig();

const sql = postgres(connectionString, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder: "database/migrations" });
  console.log("Database migrations: OK");
} finally {
  await sql.end();
}
