import "dotenv/config";
import { spawn, type ChildProcess } from "node:child_process";

const env = { ...process.env, NODE_ENV: "test", API_PORT: "3001" };

const children: ChildProcess[] = [];
const start = (script: string) => {
  const child = spawn(process.execPath, ["--import", "tsx/esm", script], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
  });
  children.push(child);
  return child;
};

const api = start("apps/api/src/server.ts");
start("apps/worker/src/index.ts");

function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
api.once("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});

await new Promise(() => undefined);
