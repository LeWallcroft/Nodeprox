import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./database/schema/*.ts",
  out: "./database/migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://nodeprox:nodeprox@127.0.0.1:5432/nodeprox",
  },
  strict: true,
  verbose: true,
});
