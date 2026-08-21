import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("M2-A role bootstrap migration", () => {
  it("assigns the conservative default without blocking existing users", async () => {
    const migration = await readFile(
      "database/migrations/0003_medical_the_stranger.sql",
      "utf8",
    );
    expect(migration).toContain("DEFAULT 'uploader'");
    expect(migration).not.toContain("RAISE EXCEPTION");
    expect(migration).not.toContain("ADMIN_BOOTSTRAP");
  });
});
