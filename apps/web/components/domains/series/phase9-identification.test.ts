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

  it("keeps settings units explicit", () => {
    const settings = read("apps/web/app/(dashboard)/admin/settings/page.tsx");
    expect(settings).toContain('"MB"');
    expect(settings).toContain('"px"');
  });
});
