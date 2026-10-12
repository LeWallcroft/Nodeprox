import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd());

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
      ? [path]
      : [];
  });
}

describe("HTTP error layering", () => {
  it("keeps SQLSTATE inspection out of Presentation", () => {
    const violations = sourceFiles(join(root, "apps/api/src"))
      .filter((file) => /[/\\]presentation[/\\]/.test(file))
      .filter((file) => /23505/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file));
    expect(violations).toEqual([]);
  });

  it("keeps AppError imports out of domain, application and infrastructure", () => {
    const violations = sourceFiles(join(root, "apps/api/src"))
      .filter((file) =>
        /[/\\](domain|application|infrastructure)[/\\]/.test(file),
      )
      .filter((file) =>
        /(?:from\s*["'][^"']*app-error(?:\.js)?["']|import\s*\([^)]*app-error)/.test(
          readFileSync(file, "utf8"),
        ),
      )
      .map((file) => relative(root, file));
    expect(violations).toEqual([]);
  });
});
