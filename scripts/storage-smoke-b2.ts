import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  loadStorageConfig,
  type NodeProxStorageConfig,
} from "@nodeprox/config";
import { B2Storage } from "../apps/api/src/modules/uploads/infrastructure/storage/b2.storage.js";

type SafeFailure = {
  name?: string;
  code?: string;
  message: string;
  status?: number;
};

const key = `smoke-tests/${randomUUID()}.txt`;
let storage: B2Storage | undefined;

function safeFailure(error: unknown): SafeFailure {
  if (typeof error !== "object" || error === null)
    return { message: "unknown error" };
  const value = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    $metadata?: { httpStatusCode?: unknown };
    issues?: Array<{ path?: unknown }>;
  };
  const issuePath = value.issues?.[0]?.path;
  if (Array.isArray(value.issues) && Array.isArray(issuePath)) {
    const field = issuePath
      .filter((part): part is string => typeof part === "string")
      .join(".");
    return {
      message: field
        ? `${field} is invalid or missing`
        : "configuration is invalid",
    };
  }
  const rawMessage =
    typeof value.message === "string"
      ? value.message
      : "provider request failed";
  const message =
    /https?:\/\/|authorization|bearer|credential|secret|token|key_id|application_key|[A-Za-z0-9+/]{24,}/i.test(
      rawMessage,
    )
      ? "provider request failed"
      : rawMessage.replace(/\s+/g, " ").slice(0, 160);
  const status =
    typeof value.$metadata?.httpStatusCode === "number"
      ? value.$metadata.httpStatusCode
      : undefined;
  return {
    ...(typeof value.name === "string" ? { name: value.name } : {}),
    ...(typeof value.code === "string" ? { code: value.code } : {}),
    message,
    ...(status !== undefined ? { status } : {}),
  };
}

function reportFailure(
  operation: string,
  error: unknown,
  cleanup?: SafeFailure,
): never {
  const failure = safeFailure(error);
  console.error("B2 smoke test: FAIL");
  console.error(`operation: ${operation}`);
  if (failure.name) console.error(`error_name: ${failure.name}`);
  if (failure.code) console.error(`error_code: ${failure.code}`);
  if (failure.status !== undefined)
    console.error(`http_status: ${failure.status}`);
  console.error(`error: ${failure.message}`);
  if (cleanup) console.error(`cleanup_error: ${cleanup.message}`);
  process.exitCode = 1;
  throw new Error("B2 smoke test failed");
}

try {
  let config: NodeProxStorageConfig;
  try {
    config = loadStorageConfig();
    if (config.provider !== "b2")
      throw new Error("NODE_ENV must be production for B2 smoke test");
  } catch (error) {
    reportFailure("configuration", error);
  }

  try {
    storage = new B2Storage(config.b2);
  } catch (error) {
    reportFailure("adapter", error);
  }

  let existsBefore: boolean;
  try {
    existsBefore = await storage.exists(key);
  } catch (error) {
    reportFailure("exists", error);
  }
  if (existsBefore)
    reportFailure("exists", new Error("temporary key already exists"));

  const body = Buffer.from("NodeProx B2 operational smoke test", "utf8");
  try {
    await storage.put({
      key,
      body: Readable.from([body]),
      contentType: "text/plain",
      sizeBytes: body.byteLength,
    });
  } catch (error) {
    let cleanup: SafeFailure | undefined;
    try {
      await storage.delete(key);
    } catch (cleanupError) {
      cleanup = safeFailure(cleanupError);
    }
    reportFailure("put", error, cleanup);
  }

  try {
    if (!(await storage.exists(key)))
      throw new Error("object not found after put");
  } catch (error) {
    let cleanup: SafeFailure | undefined;
    try {
      await storage.delete(key);
    } catch (cleanupError) {
      cleanup = safeFailure(cleanupError);
    }
    reportFailure("exists", error, cleanup);
  }

  try {
    const stream = await storage.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    if (!Buffer.concat(chunks).equals(body))
      throw new Error("object content mismatch after get");
  } catch (error) {
    let cleanup: SafeFailure | undefined;
    try {
      await storage.delete(key);
    } catch (cleanupError) {
      cleanup = safeFailure(cleanupError);
    }
    reportFailure("get", error, cleanup);
  }

  try {
    await storage.delete(key);
  } catch (error) {
    reportFailure("delete", error);
  }

  try {
    if (await storage.exists(key))
      throw new Error("object still exists after delete");
  } catch (error) {
    reportFailure("cleanup", error);
  }

  console.log("B2 smoke test: PASS");
  console.log("✓ configuration");
  console.log("✓ put");
  console.log("✓ exists");
  console.log("✓ get");
  console.log("✓ delete");
  console.log("✓ cleanup");
} catch {
  // reportFailure already emitted a sanitized diagnostic.
}
