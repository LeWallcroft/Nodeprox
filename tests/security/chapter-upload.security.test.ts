import { describe, expect, it } from "vitest";
import { FilesystemStorage } from "../../apps/api/src/modules/uploads/infrastructure/storage/filesystem.storage.js";

describe("chapter upload storage security", () => {
  it("rejects path traversal keys in the development adapter", async () => {
    const storage = new FilesystemStorage(".nodeprox-test-storage");
    await expect(storage.exists("../../secrets.zip")).rejects.toThrow(
      "Invalid storage key",
    );
  });
});
