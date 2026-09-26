import "dotenv/config";
import { join } from "node:path";
import {
  loadConfig,
  loadProcessingConfig,
  loadStorageConfig,
} from "@nodeprox/config";
import {
  B2Storage,
  FilesystemStorage,
} from "../packages/storage/src/adapters.js";
import { createDatabase } from "../database/client.js";
import { IntegrityReconciliationService } from "../apps/api/src/modules/reconciliation/application/integrity-reconciliation.service.js";
import { BullMQReconciliationQueue } from "../apps/api/src/modules/reconciliation/infrastructure/bullmq-reconciliation.queue.js";
import { DrizzleIntegrityRepository } from "../apps/api/src/modules/reconciliation/infrastructure/drizzle-integrity.repository.js";
import type { ReconciliationCursor } from "../apps/api/src/modules/reconciliation/application/integrity-reconciliation.service.js";

const config = loadConfig();
const processing = loadProcessingConfig();
const storageConfig = loadStorageConfig();
const storage =
  storageConfig.provider === "b2"
    ? new B2Storage(storageConfig.b2)
    : new FilesystemStorage(join(process.cwd(), ".nodeprox-storage"));
const database = createDatabase(config.DATABASE_URL);
const queue = new BullMQReconciliationQueue(
  config.REDIS_URL,
  processing.PROCESSING_QUEUE_NAME,
);
const dryRun = !process.argv.includes("--repair");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 20;
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
  throw new Error("invalid-reconciliation-limit");
const cursorArg = process.argv.find((arg) => arg.startsWith("--cursor="));
let cursor: ReconciliationCursor = {};
if (cursorArg) {
  const parsed: unknown = JSON.parse(
    Buffer.from(cursorArg.slice("--cursor=".length), "base64url").toString(
      "utf8",
    ),
  );
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("invalid-reconciliation-cursor");
  const validKeys = new Set([
    "processingIntents",
    "deletionIntents",
    "replacementIntents",
    "ready",
    "candidates",
    "attempts",
    "sources",
    "cleanupIntents",
  ]);
  for (const [key, value] of Object.entries(parsed)) {
    if (
      !validKeys.has(key) ||
      typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      throw new Error("invalid-reconciliation-cursor");
  }
  cursor = parsed as ReconciliationCursor;
}
const logger = {
  info: (context: unknown, message: string) =>
    process.stdout.write(
      `${JSON.stringify({ level: "info", message, context })}\n`,
    ),
  error: (context: unknown, message: string) =>
    process.stderr.write(
      `${JSON.stringify({ level: "error", message, context })}\n`,
    ),
};
try {
  const result = await new IntegrityReconciliationService(
    new DrizzleIntegrityRepository(database.db),
    queue,
    storage,
    logger,
  ).run({ limit, cursor, dryRun });
  process.stdout.write(
    `${JSON.stringify({ dryRun, ...result, nextCursorToken: Buffer.from(JSON.stringify(result.nextCursor)).toString("base64url") })}\n`,
  );
} finally {
  await queue.close();
  await database.sql.end();
}
