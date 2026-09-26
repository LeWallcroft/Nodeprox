import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());
const consumers = ["apps", "database", "scripts", "tests"];
const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const importSpecifier = /\b(?:from\s*|import\s*\(|import\s*)["']([^"']+)["']/g;
const directSource =
  /(?:^@nodeprox\/[^/]+\/src(?:\/|$)|(?:^|\/)packages\/[^/]+\/src(?:\/|$))/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", ".next", "coverage"].includes(entry.name))
      return [];
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(path)
      : sourceFile.test(entry.name)
        ? [path]
        : [];
  });
}

function violations(source: string): string[] {
  return [...source.matchAll(importSpecifier)]
    .map((match) => match[1])
    .filter((specifier): specifier is string => typeof specifier === "string")
    .filter((specifier) => directSource.test(specifier));
}

describe("public package import boundary", () => {
  it("rejects package source imports from external consumers", () => {
    expect(
      violations('import { x } from "../../packages/storage/src/port.js"'),
    ).toHaveLength(1);
    expect(violations('import "packages/types/src/index.js"')).toHaveLength(1);
    expect(violations('import "@nodeprox/storage/src/port"')).toHaveLength(1);
    expect(violations('import "@nodeprox/storage/port"')).toEqual([]);
  });

  it("uses only published package exports throughout apps, database, scripts and tests", () => {
    const forbidden: string[] = [];
    const unpublished: string[] = [];
    const packageExports = new Map<string, Set<string>>();
    for (const consumer of consumers) {
      for (const file of sourceFiles(join(root, consumer))) {
        if (
          relative(root, file).replaceAll("\\", "/") ===
          "tests/unit/package-import-boundary.test.ts"
        )
          continue;
        const content = readFileSync(file, "utf8");
        const imports = [...content.matchAll(importSpecifier)]
          .map((match) => match[1])
          .filter(
            (specifier): specifier is string => typeof specifier === "string",
          );
        for (const specifier of imports) {
          if (directSource.test(specifier))
            forbidden.push(`${relative(root, file)}: ${specifier}`);
          const packageName = /^(@nodeprox\/[^/]+)(?:\/(.*))?$/.exec(specifier);
          if (!packageName) continue;
          const name = packageName[1];
          if (!name) continue;
          let exports = packageExports.get(name);
          if (!exports) {
            const manifest = JSON.parse(
              readFileSync(
                join(
                  root,
                  "packages",
                  name.slice("@nodeprox/".length),
                  "package.json",
                ),
                "utf8",
              ),
            ) as { exports: Record<string, unknown> };
            exports = new Set(Object.keys(manifest.exports));
            packageExports.set(name, exports);
          }
          if (!exports.has(packageName[2] ? `./${packageName[2]}` : "."))
            unpublished.push(`${relative(root, file)}: ${specifier}`);
        }
      }
    }
    expect(forbidden).toEqual([]);
    expect(unpublished).toEqual([]);
  });
});
