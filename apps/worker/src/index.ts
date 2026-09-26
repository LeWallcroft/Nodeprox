import "dotenv/config";
import { createWorkerDependencies } from "./composition/create-worker-dependencies.js";
import { createWorkerRuntime } from "./composition/create-worker-runtime.js";

const runtime = createWorkerRuntime(createWorkerDependencies());
runtime.start();

let shutdownStarted = false;
async function shutdown() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await runtime.stop();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
