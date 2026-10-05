import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { ChapterZipInspector } from "../../apps/worker/src/admission-validation/infrastructure/zip/chapter-zip.inspector.js";
import type { AdmissionLimits } from "../../apps/worker/src/admission-validation/domain/admission-validation.policy.js";

const gif = Buffer.from([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
]);
const limits: AdmissionLimits = {
  maxEntries: 1000,
  maxTotalBytes: 512 * 1024 * 1024,
  maxImageBytes: 64 * 1024 * 1024,
  warnImageBytes: 8 * 1024 * 1024,
  warnWidthPx: 4000,
  warnHeightPx: 12000,
};

function zip(entries: { name: string; data: Buffer }[]): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(Buffer.concat([header, name, entry.data]));
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(entry.data.length, 20);
    directory.writeUInt32LE(entry.data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([directory, name]));
    offset += 30 + name.length + entry.data.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBytes, end]);
}

async function inspect(
  entries: { name: string; data: Buffer }[],
  overrides: Partial<AdmissionLimits> = {},
) {
  return new ChapterZipInspector({ ...limits, ...overrides }).inspect(
    Readable.from(zip(entries)),
  );
}

describe("upload admission", () => {
  it("accepts a valid ZIP and persists enough identity for processing", async () => {
    const result = await inspect([{ name: "01.gif", data: gif }]);
    expect(result.outcome).toBe("accepted");
    if (result.outcome === "accepted")
      expect(result.manifest[0]).toMatchObject({
        filename: "01.gif",
        sortOrder: 1,
        contentType: "image/gif",
        sizeBytes: gif.length,
        widthPx: 1,
        heightPx: 1,
      });
  });

  it.each([
    ["bad.gif", gif, "IMAGE_FILENAME_INVALID"],
    ["01.gif", Buffer.from("not a GIF"), "IMAGE_MAGIC_MISMATCH"],
    ["../01.gif", gif, "ZIP_INVALID_PATH"],
    ["wrapper/01.gif", gif, "ZIP_INVALID_LAYOUT"],
  ] as const)(
    "rejects %s or invalid image content with %s",
    async (name, data, code) => {
      const entries =
        name === "wrapper/01.gif"
          ? [
              { name: "01.gif", data: gif },
              { name, data },
            ]
          : [{ name, data }];
      const result = await inspect(entries);
      expect(result.outcome).toBe("rejected");
      expect(result.issues.map((issue) => issue.code)).toContain(code);
    },
  );

  it("collects several safe image issues in one report", async () => {
    const result = await inspect([
      { name: "01.gif", data: gif },
      { name: "01.gif", data: Buffer.from("bad") },
      { name: "bad.gif", data: gif },
    ]);
    expect(result.outcome).toBe("rejected");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "IMAGE_DUPLICATE_FILENAME",
        "IMAGE_DUPLICATE_SORT_ORDER",
        "IMAGE_MAGIC_MISMATCH",
        "IMAGE_FILENAME_INVALID",
      ]),
    );
  });

  it.each([
    [
      { maxEntries: 1 },
      [
        { name: "01.gif", data: gif },
        { name: "02.gif", data: gif },
      ],
      "ZIP_ENTRY_LIMIT_EXCEEDED",
    ],
    [
      { maxTotalBytes: gif.length - 1 },
      [{ name: "01.gif", data: gif }],
      "ZIP_TOTAL_SIZE_EXCEEDED",
    ],
    [
      { maxImageBytes: gif.length - 1 },
      [{ name: "01.gif", data: gif }],
      "IMAGE_SIZE_EXCEEDED",
    ],
    [
      { maxWidthPx: 0 },
      [{ name: "01.gif", data: gif }],
      "IMAGE_WIDTH_EXCEEDED",
    ],
    [
      { maxHeightPx: 0 },
      [{ name: "01.gif", data: gif }],
      "IMAGE_HEIGHT_EXCEEDED",
    ],
    [
      { maxPixels: 0 },
      [{ name: "01.gif", data: gif }],
      "IMAGE_PIXELS_EXCEEDED",
    ],
  ] as const)(
    "enforces a configured hard limit",
    async (override, entries, code) => {
      const result = await inspect([...entries], override);
      expect(result.outcome).toBe("rejected");
      expect(result.issues.map((issue) => issue.code)).toContain(code);
    },
  );
});
