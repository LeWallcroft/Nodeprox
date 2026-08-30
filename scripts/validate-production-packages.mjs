import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packages = ["config", "schemas", "storage", "types"];
const applications = [
  {
    name: "@nodeprox/api",
    manifestDirectory: "apps/api",
    runtimeDirectories: [
      "apps/api/dist/apps/api/src",
      "apps/api/dist/database",
      "deploy/migration",
    ],
  },
  {
    name: "@nodeprox/worker",
    manifestDirectory: "apps/worker",
    runtimeDirectories: [
      "apps/worker/dist/apps/worker/src",
      "apps/worker/dist/database",
    ],
  },
];
const runtimeImports = [
  { label: "@nodeprox/config", packageName: "config", subpath: "." },
  { label: "@nodeprox/schemas", packageName: "schemas", subpath: "." },
  { label: "@nodeprox/storage", packageName: "storage", subpath: "." },
  {
    label: "@nodeprox/storage/port",
    packageName: "storage",
    subpath: "./port",
  },
  {
    label: "@nodeprox/storage/adapters",
    packageName: "storage",
    subpath: "./adapters",
  },
  { label: "@nodeprox/types", packageName: "types", subpath: "." },
];

function fail(message) {
  throw new Error(`production-package-validation: ${message}`);
}

function externalPackageName(specifier) {
  if (
    specifier.startsWith("node:") ||
    specifier.startsWith(".") ||
    specifier.startsWith("/")
  )
    return null;
  if (specifier.startsWith("@"))
    return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0];
}

function exportTargets(exportsValue) {
  if (typeof exportsValue === "string") return [exportsValue];
  if (!exportsValue || typeof exportsValue !== "object") return [];
  return Object.values(exportsValue).flatMap(exportTargets);
}

function runtimeSpecifiers(source) {
  const specifiers = [];
  const fromOrDynamicImport = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  const sideEffectImport = /^\s*import\s*["']([^"']+)["']/gm;
  for (const match of source.matchAll(fromOrDynamicImport))
    specifiers.push(match[1]);
  for (const match of source.matchAll(sideEffectImport))
    specifiers.push(match[1]);
  return specifiers;
}

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await javascriptFiles(entryPath)));
    else if (entry.isFile() && entry.name.endsWith(".js"))
      files.push(entryPath);
  }
  return files;
}

for (const packageDirectoryName of packages) {
  const packageDirectory = join(
    repositoryRoot,
    "packages",
    packageDirectoryName,
  );
  const manifestPath = join(packageDirectory, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const targets = exportTargets(manifest.exports);

  if (!Array.isArray(manifest.files) || !manifest.files.includes("dist"))
    fail(`${manifest.name} must publish only its compiled dist artifact`);
  if (targets.length === 0) fail(`${manifest.name} has no production exports`);

  for (const target of targets) {
    if (
      !target.startsWith("./dist/") ||
      target.includes("/src/") ||
      (target.endsWith(".ts") && !target.endsWith(".d.ts"))
    )
      fail(`${manifest.name} export points outside compiled dist: ${target}`);
    await access(join(packageDirectory, target));
  }

  const declaredDependencies = new Set(
    Object.keys(manifest.dependencies ?? {}),
  );
  const distDirectory = join(packageDirectory, "dist");
  for (const javascriptFile of await javascriptFiles(distDirectory)) {
    const source = await readFile(javascriptFile, "utf8");
    for (const specifier of runtimeSpecifiers(source)) {
      const dependency = externalPackageName(specifier);
      if (dependency && !declaredDependencies.has(dependency))
        fail(
          `${manifest.name} imports undeclared runtime dependency ${dependency} in ${relative(repositoryRoot, javascriptFile)}`,
        );
    }
  }
}

for (const runtimeImport of runtimeImports) {
  const packageDirectory = join(
    repositoryRoot,
    "packages",
    runtimeImport.packageName,
  );
  const manifest = JSON.parse(
    await readFile(join(packageDirectory, "package.json"), "utf8"),
  );
  const target = manifest.exports?.[runtimeImport.subpath]?.import;
  if (typeof target !== "string")
    fail(`${runtimeImport.label} has no import export target`);
  await import(pathToFileURL(join(packageDirectory, target)).href);
}

for (const application of applications) {
  const applicationDirectory = join(
    repositoryRoot,
    application.manifestDirectory,
  );
  const manifest = JSON.parse(
    await readFile(join(applicationDirectory, "package.json"), "utf8"),
  );
  const declaredDependencies = new Set(
    Object.keys(manifest.dependencies ?? {}),
  );

  for (const runtimeDirectory of application.runtimeDirectories) {
    for (const javascriptFile of await javascriptFiles(
      join(repositoryRoot, runtimeDirectory),
    )) {
      if (javascriptFile.endsWith(".test.js")) continue;
      const source = await readFile(javascriptFile, "utf8");
      for (const specifier of runtimeSpecifiers(source)) {
        const dependency = externalPackageName(specifier);
        if (dependency && !declaredDependencies.has(dependency))
          fail(
            `${application.name} imports undeclared runtime dependency ${dependency} in ${relative(repositoryRoot, javascriptFile)}`,
          );
      }
    }
  }
}

try {
  await access(join(repositoryRoot, "apps/web/next.config.ts"));
  fail("@nodeprox/web production config must not require a TypeScript loader");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
await access(join(repositoryRoot, "apps/web/next.config.mjs"));

console.log(
  `Production workspace packages: OK (${runtimeImports.length} runtime exports and ${applications.length} applications validated)`,
);
