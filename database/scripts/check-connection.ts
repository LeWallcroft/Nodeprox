import "dotenv/config";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required");
}

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
