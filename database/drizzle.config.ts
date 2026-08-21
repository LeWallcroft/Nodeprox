import "dotenv/config";
import { loadDatabaseConfig } from "@nodeprox/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./database/schema/*.ts",
  out: "./database/migrations",
  dbCredentials: {
    url: loadDatabaseConfig().DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
