import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const composeArguments = [
  "compose",
  "-f",
  "docker-compose.prod.yml",
  "--env-file",
  ".env.production.example",
  "--profile",
  "operations",
  "config",
  "--format",
  "json",
];

const rendered = execFileSync("docker", composeArguments, {
  cwd: repositoryRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    NODEPROX_ENV_FILE: ".env.production.example",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

const compose = JSON.parse(rendered);
const bot = compose.services?.["discord-bot"];
const api = compose.services?.api;

if (!bot || !api) throw new Error("Discord bot or API service is missing.");
if (bot.env_file) throw new Error("Discord bot must not inherit an env_file.");

const permitted = new Set([
  "NODE_ENV",
  "DISCORD_APPLICATION_ID",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "DISCORD_CONTROL_CHANNEL_ID",
  "DISCORD_BOT_INTERNAL_TOKEN",
  "NODEPROX_INTERNAL_API_URL",
  "DISCORD_BOT_INTERNAL_HOST",
  "DISCORD_BOT_INTERNAL_PORT",
  "LOG_LEVEL",
]);
const required = [
  "DISCORD_APPLICATION_ID",
  "DISCORD_BOT_TOKEN",
  "DISCORD_GUILD_ID",
  "DISCORD_CONTROL_CHANNEL_ID",
  "DISCORD_BOT_INTERNAL_TOKEN",
];
const forbidden = [
  "DATABASE_URL",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "REDIS_URL",
  "REDIS_PASSWORD",
  "B2_ENDPOINT",
  "B2_REGION",
  "B2_BUCKET",
  "B2_KEY_ID",
  "B2_APPLICATION_KEY",
  "CLOUDFLARE_ZONE_ID",
  "CLOUDFLARE_PURGE_API_TOKEN",
  "EMAIL_PROVIDER",
  "BREVO_API_KEY",
  "EMAIL_FROM_EMAIL",
  "EMAIL_FROM_NAME",
  "ADMIN_BOOTSTRAP_EMAIL",
  "ADMIN_BOOTSTRAP_PASSWORD",
];

const botEnvironment = Object.keys(bot.environment ?? {});
const unexpected = botEnvironment.filter((name) => !permitted.has(name));
const missing = required.filter((name) => !botEnvironment.includes(name));
const leaked = forbidden.filter((name) => botEnvironment.includes(name));

if (unexpected.length || missing.length || leaked.length)
  throw new Error("Discord bot environment isolation validation failed.");
if (bot.ports?.length) throw new Error("Discord bot must not publish ports.");
if (api.environment?.DISCORD_BOT_INTERNAL_URL !== "http://discord-bot:3002")
  throw new Error("API Discord bot URL must use internal Docker DNS.");
if (bot.environment?.NODEPROX_INTERNAL_API_URL !== "http://api:3001")
  throw new Error("Discord bot API URL must use internal Docker DNS.");
const botNetworks = new Set(Object.keys(bot.networks ?? {}));
if (!botNetworks.has("internal") || !botNetworks.has("egress"))
  throw new Error("Discord bot must use internal and egress networks.");

console.log("Discord bot compose environment isolation: PASS");
