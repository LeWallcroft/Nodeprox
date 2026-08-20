import { buildApp } from "./app.js";

const app = buildApp();
const host = process.env.API_HOST ?? "127.0.0.1";
const port = Number(process.env.API_PORT ?? 3000);

try {
  await app.listen({ host, port });
  console.log(`API listening on http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
