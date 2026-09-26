import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { UnzipperExtractor } from "../../apps/worker/src/processing/infrastructure/zip/unzipper.extractor.js";

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

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
const webp = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
);
const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);

function extractor() {
  return new UnzipperExtractor({
    maxEntries: 10,
    maxTotalBytes: 1024,
    maxImageBytes: 128,
  });
}

describe("UnzipperExtractor", () => {
  it.each([
    [
      "WebP presentation image",
      [
        { name: "02.webp", data: webp },
        { name: "00.webp", data: webp },
        { name: "01.webp", data: webp },
      ],
      ["00.webp", "01.webp", "02.webp"],
    ],
    [
      "mixed presentation image",
      [
        { name: "02.png", data: png },
        { name: "00.jpg", data: jpeg },
        { name: "01.webp", data: webp },
      ],
      ["00.jpg", "01.webp", "02.png"],
    ],
    [
      "without presentation image",
      [
        { name: "02.webp", data: webp },
        { name: "01.webp", data: webp },
      ],
      ["01.webp", "02.webp"],
    ],
  ])("sorts %s numerically", async (_label, entries, expected) => {
    const instance = extractor();
    try {
      const images = await instance.inspect(
        Readable.from([zipStored(entries)]),
      );
      expect(images.map((image) => image.filename)).toEqual(expected);
      expect(images.map((image) => image.sortOrder)).toEqual(
        expected.map((name) => Number(name.slice(0, 2))),
      );
    } finally {
      await instance.dispose();
    }
  });

  it("rejects more than one presentation index", async () => {
    const instance = extractor();
    await expect(
      instance.inspect(
        Readable.from([
          zipStored([
            { name: "00.jpg", data: jpeg },
            { name: "00.webp", data: webp },
          ]),
        ]),
      ),
    ).rejects.toThrow("duplicate-image-sort-order");
    await instance.dispose();
  });

  it("accepts sequential WebP names and sorts 01 through 11 numerically", async () => {
    const instance = new UnzipperExtractor({
      maxEntries: 20,
      maxTotalBytes: 2048,
      maxImageBytes: 128,
    });
    const names = Array.from(
      { length: 11 },
      (_, index) => `${String(index + 1).padStart(2, "0")}.webp`,
    );
    try {
      const images = await instance.inspect(
        Readable.from([
          zipStored(names.toReversed().map((name) => ({ name, data: webp }))),
        ]),
      );
      expect(images.map((image) => image.filename)).toEqual(names);
      expect(images.map((image) => image.sortOrder)).toEqual(
        Array.from({ length: 11 }, (_, index) => index + 1),
      );
      expect(
        images.every(
          (image) =>
            image.extension === "webp" &&
            image.contentType === "image/webp" &&
            image.sizeBytes === webp.length,
        ),
      ).toBe(true);
      for (const image of images)
        expect(await readStream(instance.readImage(image))).toEqual(webp);
    } finally {
      await instance.dispose();
    }
  });

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

  it("accepts exactly one common wrapper and strips it from image identity", async () => {
    const instance = extractor();
    try {
      const images = await instance.inspect(
        Readable.from([
          zipStored([
            { name: "24/02.png", data: png },
            { name: "24/01.jpg", data: jpeg },
            { name: "24/03.webp", data: webp },
          ]),
        ]),
      );
      expect(images.map((image) => image.filename)).toEqual([
        "01.jpg",
        "02.png",
        "03.webp",
      ]);
    } finally {
      await instance.dispose();
    }
  });

  it.each([
    [
      "two wrappers",
      [
        { name: "24/01.jpg", data: jpeg },
        { name: "25/02.png", data: png },
      ],
    ],
    [
      "root and wrapper",
      [
        { name: "01.jpg", data: jpeg },
        { name: "24/02.png", data: png },
      ],
    ],
    ["nested directory", [{ name: "24/pages/01.jpg", data: jpeg }]],
    ["windows traversal", [{ name: "..\\01.jpg", data: jpeg }]],
  ])("rejects %s", async (_name, entries) => {
    const instance = extractor();
    await expect(
      instance.inspect(Readable.from([zipStored(entries)])),
    ).rejects.toThrow();
    await instance.dispose();
  });

  it("rejects duplicate filenames after wrapper normalization", async () => {
    const instance = extractor();
    await expect(
      instance.inspect(
        Readable.from([
          zipStored([
            { name: "24/01.jpg", data: jpeg },
            { name: "24/01.jpg", data: jpeg },
          ]),
        ]),
      ),
    ).rejects.toThrow("duplicate-image-filename");
    await instance.dispose();
  });

  it("emits media warnings from bounded header metadata without rejecting", async () => {
    const oversizedPng = Buffer.alloc(24);
    oversizedPng.set(png);
    oversizedPng.writeUInt32BE(5000, 16);
    oversizedPng.writeUInt32BE(13000, 20);
    const instance = new UnzipperExtractor({
      maxEntries: 10,
      maxTotalBytes: 1024,
      maxImageBytes: 128,
      warnImageBytes: 10,
      warnWidthPx: 4000,
      warnHeightPx: 12000,
    });
    try {
      const [image] = await instance.inspect(
        Readable.from([zipStored([{ name: "01.png", data: oversizedPng }])]),
      );
      expect(image?.warnings.map((warning) => warning.code)).toEqual([
        "large-file",
        "wide-image",
        "tall-image",
      ]);
      expect(image?.sizeBytes).toBe(oversizedPng.length);
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
