import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { stageMultipartFile } from "../../apps/api/src/modules/uploads/presentation/multipart-file.js";

describe("multipart staging", () => {
  it("counts the complete file without a second read of the source", async () => {
    const payload = Buffer.from("PK\x03\x04nodeprox-upload");
    const source = Readable.from([payload]);
    const staged = await stageMultipartFile(source);

    try {
      expect(staged.sizeBytes).toBe(payload.length);
      expect([...staged.magicBytes]).toEqual([...payload.subarray(0, 4)]);
      expect(await staged.stream.toArray()).toEqual([payload]);
      expect(source.readableEnded).toBe(true);
    } finally {
      await staged.cleanup();
      await staged.cleanup();
    }
  });
});
