import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

const sql = postgres(connectionString, { max: 1 });

try {
  await migrate(drizzle(sql), { migrationsFolder: "database/migrations" });
  console.log("Database migrations: OK");
} finally {
  await sql.end();
}
