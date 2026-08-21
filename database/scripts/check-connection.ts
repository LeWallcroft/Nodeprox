import "dotenv/config";
import { loadDatabaseConfig } from "@nodeprox/config";
import postgres from "postgres";

const { DATABASE_URL: connectionString } = loadDatabaseConfig();

const sql = postgres(connectionString, { max: 1 });

try {
  const result = await sql`select 1 as connected`;
  if (result[0]?.connected !== 1) {
    throw new Error(
      "PostgreSQL connection check returned an unexpected result",
    );
  }
  console.log("PostgreSQL connection: OK");
} finally {
  await sql.end();
}
