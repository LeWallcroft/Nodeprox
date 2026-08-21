import "dotenv/config";
import { randomUUID } from "node:crypto";
import { loadDatabaseConfig } from "@nodeprox/config";
import { createDatabase } from "../../database/client.js";
import {
  Argon2PasswordHasher,
  UserRepository,
} from "../../apps/api/src/modules/authentication/index.js";

const args = new Map(
  process.argv
    .slice(2)
    .reduce<[string, string][]>((values, value, index, all) => {
      const next = all[index + 1];
      if (value.startsWith("--") && next) values.push([value.slice(2), next]);
      return values;
    }, []),
);
const email = args.get("email")?.trim().toLowerCase();
const password = args.get("password");

if (!email || !password) {
  throw new Error(
    "Usage: pnpm db:seed:auth -- --email user@example.com --password '<password>'",
  );
}

const { DATABASE_URL } = loadDatabaseConfig();
const database = createDatabase(DATABASE_URL);
const users = new UserRepository(database.db);
const existing = await users.findByEmail(email);
if (existing) throw new Error("A user with this email already exists");

try {
  await users.create({
    id: randomUUID(),
    email,
    passwordHash: await new Argon2PasswordHasher().hash(password),
    status: "active",
  });
  console.log("Authentication user created: OK");
} finally {
  await database.sql.end();
}
