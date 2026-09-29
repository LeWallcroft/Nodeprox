import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Phase 9 user identification presentation", () => {
  it("renders responsible and helper identifiers with safe legacy fallbacks", () => {
    const responsible = read(
      "apps/web/components/domains/series/assign-series-user-dialog.tsx",
    );
    const helpers = read(
      "apps/web/components/domains/series/manage-series-helpers-dialog.tsx",
    );
    expect(responsible).toContain("candidate.email");
    expect(helpers).toContain("candidate.discordUsername");
    expect(helpers).toContain("candidate.email");
  });

  it("keeps settings units in the canonical API registry, not a Web key heuristic", () => {
    const registry = read(
      "apps/api/src/modules/authorization/domain/product-settings.registry.ts",
    );
    const page = read("apps/web/app/(dashboard)/admin/settings/page.tsx");
    expect(registry).toContain('unit: "MB"');
    expect(registry).toContain('unit: "px"');
    expect(registry).toContain('unit: "cargas"');
    expect(page).not.toContain("upload_warning_image_size_mb");
    expect(page).not.toContain('"MB"');
  });
});
