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
  it("keeps raw error messages out of Series lifecycle UI", () => {
    const files = [
      "reactivation-review-dialog.tsx",
      "reactivation-request-dialog.tsx",
      "assign-series-user-dialog.tsx",
      "inactive-series-detail-panel.tsx",
      "series-detail-panel.tsx",
    ];
    const violations = files.filter((name) =>
      /(?:cause|error)\.message/.test(
        readFileSync(
          join(root, "apps/web/components/domains/series", name),
          "utf8",
        ),
      ),
    );
    expect(violations).toEqual([]);
  });
  it("keeps SQLSTATE inspection out of Presentation", () => {
    const violations = sourceFiles(join(root, "apps/api/src"))
      .filter((file) => /[/\\]presentation[/\\]/.test(file))
      .filter((file) => /23505/.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file));
    expect(violations).toEqual([]);
  });

  it("keeps PostgreSQL-native inspection out of API Application", () => {
    const application = sourceFiles(join(root, "apps/api/src/modules")).filter(
      (file) => /[/\\]application[/\\]/.test(file),
    );
    const violations = application
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return (
          /\b(?:23505|23503|23514|40001|40P01)\b/.test(source) ||
          /\bconstraint_name\b|\.(?:constraint|constraintName)\b/.test(source)
        );
      })
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

  it("keeps workflow and correlation identities explicit", () => {
    const seriesLifecycleFiles = [
      "apps/api/src/modules/series/application/ports/series-lifecycle.ports.ts",
      "apps/api/src/modules/series/application/services/series-lifecycle.service.ts",
      "apps/api/src/modules/series/infrastructure/persistence/drizzle/series-lifecycle.repository.ts",
      "apps/api/src/modules/series/presentation/series.plugin.ts",
    ];
    const sources = seriesLifecycleFiles.map((path) =>
      readFileSync(join(root, path), "utf8"),
    );
    const combined = sources.join("\n");
    for (const identity of [
      "correlationRequestId",
      "reactivationRequestId",
      "originRequestId",
    ]) {
      expect(combined).toContain(identity);
    }

    const crossDomainContracts = sourceFiles(join(root, "apps"))
      .filter((file) => /(?:discord|events|worker)/.test(file))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");
    for (const identity of [
      "providerRequestId",
      "interactionId",
      "eventId",
      "jobId",
    ]) {
      expect(crossDomainContracts).toContain(identity);
    }

    const contractSources = sources.slice(0, 3);
    const ambiguousWorkflowFields = contractSources.flatMap((source, index) => {
      const lifecycleSource = source.replace(
        /requestId\s*:\s*correlationRequestId/g,
        "",
      );
      return /\brequestId\s*[:?]/.test(lifecycleSource)
        ? [seriesLifecycleFiles[index]]
        : [];
    });
    expect(ambiguousWorkflowFields).toEqual([]);
    expect(sources[3]).toContain(
      "/series/:seriesId/reactivation-requests/:reactivationRequestId/",
    );
  });
});
