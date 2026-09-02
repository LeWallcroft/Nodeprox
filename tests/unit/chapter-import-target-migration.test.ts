import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("chapter import target resolution migration", () => {
  it("adds only the nullable enum column without backfilling historical rows", async () => {
    const migration = await readFile(
      new URL(
        "../../database/migrations/0020_closed_kronos.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(migration).toContain(
      "chapter_import_target_resolution\" AS ENUM('created', 'reused', 'conflict')",
    );
    expect(migration).toContain(
      'ADD COLUMN "target_resolution" "chapter_import_target_resolution"',
    );
    expect(migration).not.toMatch(/NOT NULL|DEFAULT|UPDATE|DELETE/i);
  });
});
