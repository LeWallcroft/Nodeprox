import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { UnzipperExtractor } from "../../apps/worker/src/processing/infrastructure/zip/unzipper.extractor.js";

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStored(entries: Array<{ name: string; data: Uint8Array }>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(name.length, 26);
    const localEntry = Buffer.concat([header, name, data]);
    local.push(localEntry);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt32LE(crc, 16);
    directory.writeUInt32LE(data.length, 20);
    directory.writeUInt32LE(data.length, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([directory, name]));
    offset += localEntry.length;
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

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
]);
const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

function extractor() {
  return new UnzipperExtractor({
    maxEntries: 10,
    maxTotalBytes: 1024,
    maxImageBytes: 128,
  });
}

describe("UnzipperExtractor", () => {
  it("validates mixed image formats, preserves names and sorts by prefix", async () => {
    const instance = extractor();
    try {
      const images = await instance.inspect(
        Readable.from([
          zipStored([
            { name: "03.webp", data: webp },
            { name: "01.jpg", data: jpeg },
            { name: "04.gif", data: gif },
            { name: "02.png", data: png },
          ]),
        ]),
      );
      expect(images.map((image) => image.filename)).toEqual([
        "01.jpg",
        "02.png",
        "03.webp",
        "04.gif",
      ]);
      expect(images.map((image) => image.sortOrder)).toEqual([1, 2, 3, 4]);
    } finally {
      await instance.dispose();
    }
  });

  it("rejects duplicate order, traversal and corrupt ZIP input", async () => {
    const duplicate = extractor();
    await expect(
      duplicate.inspect(
        Readable.from([
          zipStored([
            { name: "01.jpg", data: jpeg },
            { name: "01.png", data: png },
          ]),
        ]),
      ),
    ).rejects.toThrow("duplicate-image-sort-order");
    await duplicate.dispose();

    const traversal = extractor();
    await expect(
      traversal.inspect(
        Readable.from([zipStored([{ name: "../01.jpg", data: jpeg }])]),
      ),
    ).rejects.toThrow("invalid-zip-path");
    await traversal.dispose();

    const corrupt = extractor();
    await expect(
      corrupt.inspect(Readable.from([Buffer.from("not-a-zip")])),
    ).rejects.toThrow();
    await corrupt.dispose();
  });
});
