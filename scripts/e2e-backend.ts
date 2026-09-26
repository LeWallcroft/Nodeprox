import "dotenv/config";
import type {
  UploadTransferPort,
  VerifiedUploadedObject,
} from "@nodeprox/storage/port";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  loadConfig,
  loadProcessingConfig,
  loadStorageConfig,
} from "@nodeprox/config";
import { createDatabase } from "../database/client.js";
import { buildApp } from "../apps/api/src/app.js";
import { BullMQProcessingQueue } from "../apps/api/src/modules/processing/infrastructure/queue/bullmq.processing.queue.js";
import { ProcessingOutboxDispatcher } from "../apps/api/src/modules/processing/infrastructure/outbox/processing-outbox.dispatcher.js";
import { DrizzleUploadRepository } from "../apps/api/src/modules/uploads/infrastructure/persistence/drizzle/upload.repository.js";
import { UploadTransferObjectNotFoundError } from "@nodeprox/storage/port";
import { DrizzleChapterDeletionOutboxRepository } from "../apps/api/src/modules/chapters/infrastructure/persistence/drizzle/chapter-deletion-outbox.repository.js";

const env = { ...process.env, NODE_ENV: "test", API_PORT: "3101" };
Object.assign(process.env, env);
const storageRoot = resolve(process.cwd(), ".nodeprox-storage");

class E2EObjectTransfer implements UploadTransferPort {
  private readonly grants = new Map<
    string,
    { key: string; contentType: string }
  >();

  async initiate(input: {
    key: string;
    contentType: string;
    expiresInSeconds: number;
  }) {
    const token = randomUUID();
    this.grants.set(token, { key: input.key, contentType: input.contentType });
    return {
      mode: "single" as const,
      method: "PUT" as const,
      url: `http://127.0.0.1:3102/objects/${token}`,
      headers: { "content-type": input.contentType },
      expiresAt: new Date(
        Date.now() + input.expiresInSeconds * 1000,
      ).toISOString(),
    };
  }

  async verify(input: { key: string }): Promise<VerifiedUploadedObject> {
    try {
      const metadata = await stat(this.path(input.key));
      const grant = [...this.grants.values()].find(
        (candidate) => candidate.key === input.key,
      );
      return {
        key: input.key,
        sizeBytes: metadata.size,
        ...(grant ? { contentType: grant.contentType } : {}),
      };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      )
        throw new UploadTransferObjectNotFoundError();
      throw error;
    }
  }

  async abort(input: { key: string }): Promise<void> {
    await rm(this.path(input.key), { force: true });
  }

  grant(token: string) {
    return this.grants.get(token);
  }

  path(key: string): string {
    const target = resolve(join(storageRoot, key));
    if (target !== storageRoot && !target.startsWith(`${storageRoot}${sep}`))
      throw new Error("invalid-e2e-storage-key");
    return target;
  }
}

const transfer = new E2EObjectTransfer();
const objectServer = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin === "http://127.0.0.1:3100")
    response.setHeader("access-control-allow-origin", origin);
  if (request.method === "OPTIONS") {
    response.setHeader("access-control-allow-methods", "PUT, OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");
    response.writeHead(204).end();
    return;
  }
  const match = /^\/objects\/([^/?]+)$/.exec(request.url ?? "");
  const token = match?.[1];
  const grant = token ? transfer.grant(token) : undefined;
  if (request.method !== "PUT" || !grant) {
    response.writeHead(404).end();
    return;
  }
  try {
    const target = transfer.path(grant.key);
    await mkdir(dirname(target), { recursive: true });
    await pipeline(request, createWriteStream(target));
    response.writeHead(200).end();
  } catch {
    response.writeHead(500).end();
  }
});

const config = loadConfig(process.env);
const database = createDatabase(config.DATABASE_URL);
await migrate(database.db, { migrationsFolder: "database/migrations" });
const processing = loadProcessingConfig(process.env);
const storage = loadStorageConfig(process.env);
const queue = new BullMQProcessingQueue(
  config.REDIS_URL,
  processing.PROCESSING_QUEUE_NAME,
);
const dispatcher = new ProcessingOutboxDispatcher(
  new DrizzleUploadRepository(database.db),
  queue,
  new DrizzleChapterDeletionOutboxRepository(database.db),
);
const api = buildApp(
  { logger: { level: config.LOG_LEVEL } },
  {
    database: database.db,
    secureCookie: false,
    storage,
    uploadTransfer: transfer,
    publicMediaOrigin: config.PUBLIC_MEDIA_ORIGIN,
  },
);

const children: ChildProcess[] = [];
const worker = spawn(
  process.execPath,
  ["--import", "tsx/esm", "apps/worker/src/index.ts"],
  { cwd: process.cwd(), env, stdio: "inherit" },
);
children.push(worker);
dispatcher.start();
await Promise.all([
  api.listen({ host: "127.0.0.1", port: 3101 }),
  new Promise<void>((resolve) =>
    objectServer.listen(3102, "127.0.0.1", resolve),
  ),
]);

async function stop() {
  dispatcher.stop();
  for (const child of children) child.kill("SIGTERM");
  await Promise.allSettled([
    api.close(),
    new Promise<void>((resolve, reject) =>
      objectServer.close((error) => (error ? reject(error) : resolve())),
    ),
    database.sql.end(),
  ]);
}
process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
worker.once("exit", (code) => {
  if (code && code !== 0) process.exitCode = code;
});

await new Promise(() => undefined);
