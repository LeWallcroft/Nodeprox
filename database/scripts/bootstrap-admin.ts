import "dotenv/config";
import { loadAdminBootstrapConfig, loadDatabaseConfig } from "@nodeprox/config";
import { createDatabase } from "../../database/client.js";
import { Argon2PasswordHasher } from "../../apps/api/src/modules/authentication/index.js";
import { AdminBootstrapService } from "../../apps/api/src/modules/authorization/application/services/admin-bootstrap.service.js";
import { DrizzleAdminBootstrapStore } from "../../apps/api/src/modules/authorization/infrastructure/bootstrap/drizzle-admin-bootstrap.store.js";

const { DATABASE_URL } = loadDatabaseConfig();
const { ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD } =
  loadAdminBootstrapConfig();
const database = createDatabase(DATABASE_URL);

try {
  const result = await new AdminBootstrapService(
    new DrizzleAdminBootstrapStore(database.db),
    new Argon2PasswordHasher(),
  ).run({
    email: ADMIN_BOOTSTRAP_EMAIL,
    password: ADMIN_BOOTSTRAP_PASSWORD,
  });
  console.log(`Admin bootstrap: ${result.outcome}`);
} finally {
  await database.sql.end();
}
