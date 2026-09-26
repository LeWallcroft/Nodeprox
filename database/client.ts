import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export function createDatabase(connectionString: string) {
  const sql = postgres(connectionString);
  const db = drizzle(sql, { schema });

  return { db, sql };
}

export type NodeProxDatabase = ReturnType<typeof createDatabase>["db"];
export type NodeProxTransaction = Parameters<
  Parameters<NodeProxDatabase["transaction"]>[0]
>[0];
