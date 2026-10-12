import "dotenv/config";
import { createWorkerDependencies } from "./composition/create-worker-dependencies.js";
import { createWorkerRuntime } from "./composition/create-worker-runtime.js";

const dependencies = createWorkerDependencies();
const runtime = createWorkerRuntime(dependencies);
runtime.start();

let stopping: Promise<void> | null = null;
function shutdown(): Promise<void> {
  if (stopping) return stopping;
  stopping = runtime.stop();
  return stopping;
}

function signalShutdown() {
  void shutdown().catch((error: unknown) => {
    dependencies.logger.fatal(
      { err: error, event: "worker-shutdown-failed" },
      "Worker shutdown failed",
    );
    process.exitCode = 1;
  });
}
process.once("SIGTERM", signalShutdown);
process.once("SIGINT", signalShutdown);

let fatalStarted = false;
function fatal(
  reason: unknown,
  event: "uncaughtException" | "unhandledRejection",
) {
  if (fatalStarted) return;
  fatalStarted = true;
  process.exitCode = 1;
  dependencies.logger.fatal(
    { err: reason, event },
    "Fatal worker process failure",
  );
  void shutdown()
    .catch((error: unknown) => {
      dependencies.logger.fatal(
        { err: error, event: "worker-fatal-shutdown-failed" },
        "Fatal worker shutdown failed",
      );
    })
    .finally(() => process.exit(1));
}
process.once("uncaughtException", (error) => fatal(error, "uncaughtException"));
process.once("unhandledRejection", (reason) =>
  fatal(reason, "unhandledRejection"),
);
