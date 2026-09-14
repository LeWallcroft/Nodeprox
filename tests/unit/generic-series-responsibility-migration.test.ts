import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "database/migrations/0027_generic_series_responsibility.sql",
  "utf8",
);

describe("generic Series responsibility migration", () => {
  it("backfills missing assignments from active creators before renaming the column", () => {
    expect(migration).toContain("u.\"status\" <> 'active'");
    expect(migration).toContain(
      'INSERT INTO "series_assignments" ("series_id", "uploader_id", "assigned_by")',
    );
    expect(migration).toContain('s."created_by", s."created_by"');
    expect(migration).toContain(
      'RENAME COLUMN "uploader_id" TO "responsible_user_id"',
    );
  });

  it("preserves one current responsibility per Series", () => {
    expect(migration).not.toContain("DROP INDEX");
    expect(migration).toContain(
      'RENAME TO "series_assignments_responsible_user_idx"',
    );
  });
});
