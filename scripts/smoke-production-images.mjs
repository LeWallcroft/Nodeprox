import { spawnSync } from "node:child_process";

const images = [
  {
    name: "api",
    image: "nodeprox-api:latest",
    imports: [
      "@nodeprox/config",
      "@nodeprox/schemas",
      "@nodeprox/storage",
      "@nodeprox/storage/adapters",
      "@nodeprox/types",
      "argon2",
      "drizzle-orm",
      "postgres",
      "zod",
    ],
  },
  {
    name: "worker",
    image: "nodeprox-worker:latest",
    imports: [
      "@nodeprox/config",
      "@nodeprox/storage",
      "@nodeprox/storage/adapters",
      "@nodeprox/types",
      "bullmq",
      "dotenv/config",
      "drizzle-orm",
      "ioredis",
      "postgres",
    ],
  },
  {
    name: "web",
    image: "nodeprox-web:latest",
    imports: ["@nodeprox/types"],
  },
  {
    name: "migrate",
    image: "nodeprox-migrate:latest",
    imports: [
      "@nodeprox/config",
      "@nodeprox/schemas",
      "@nodeprox/storage",
      "@nodeprox/storage/adapters",
      "@nodeprox/types",
      "argon2",
      "drizzle-orm",
      "postgres",
    ],
  },
];

function runDocker(arguments_, label) {
  const result = spawnSync("docker", arguments_, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed\n${result.stdout ?? ""}${result.stderr ?? ""}`,
    );
  }
}

for (const { name, image, imports } of images) {
  const importProgram = `${imports
    .map((specifier) => `await import(${JSON.stringify(specifier)})`)
    .join(";")};`;
  runDocker(
    ["run", "--rm", "--entrypoint", "node", image, "-e", importProgram],
    `${name} runtime import resolution`,
  );

  const hygieneProgram = `
    const { existsSync } = await import("node:fs");
    const { delimiter, join } = await import("node:path");
    const forbiddenPaths = [
      "/workspace",
      "/app/node_modules/.bin/tsx",
      ...String(process.env.PATH ?? "")
        .split(delimiter)
        .flatMap((directory) => [join(directory, "pnpm"), join(directory, "tsx")]),
    ];
    const found = forbiddenPaths.filter((path) => existsSync(path));
    if (found.length > 0) {
      console.error("Forbidden runtime paths:", found.join(", "));
      process.exit(1);
    }
  `;
  runDocker(
    ["run", "--rm", "--entrypoint", "node", image, "-e", hygieneProgram],
    `${name} runtime hygiene`,
  );
  console.log(`${name}: runtime imports and hygiene OK`);
}
