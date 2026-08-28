import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import unzipper from "unzipper";
import {
  contentTypeForMagic,
  dimensionsForHeader,
  mediaWarnings,
  validateImageName,
  type ValidatedImage,
} from "../../domain/image-policy.js";
import type { ZipExtractorPort } from "../../application/ports.js";
export class UnzipperExtractor implements ZipExtractorPort {
  private tempDir: string | undefined;
  constructor(
    private readonly limits: {
      maxEntries: number;
      maxTotalBytes: number;
      maxImageBytes: number;
      warnImageBytes?: number;
      warnWidthPx?: number;
      warnHeightPx?: number;
    },
  ) {}
  async inspect(source: Readable): Promise<ValidatedImage[]> {
    this.tempDir = await mkdtemp(join(tmpdir(), "nodeprox-processing-"));
    const parser = source.pipe(unzipper.Parse({ forceStream: true }));
    const images: ValidatedImage[] = [];
    const names = new Set<string>();
    const sortOrders = new Set<number>();
    let count = 0;
    let total = 0;
    let layout: "flat" | "wrapper" | undefined;
    let wrapper: string | undefined;
    for await (const entry of parser as AsyncIterable<
      Readable & { path: string; type: string }
    >) {
      count += 1;
      if (count > this.limits.maxEntries)
        throw new Error("zip-entry-limit-exceeded");
      const rawPath = entry.path;
      if (!isSafeZipPath(rawPath)) {
        entry.resume();
        throw new Error("invalid-zip-path");
      }
      const segments = rawPath.replace(/\/$/, "").split("/");
      if (entry.type === "Directory") {
        entry.resume();
        if (segments.length !== 1 || layout === "flat")
          throw new Error("invalid-zip-layout");
        if (wrapper && wrapper !== segments[0])
          throw new Error("invalid-zip-layout");
        layout = "wrapper";
        wrapper = segments[0];
        continue;
      }
      if (entry.type !== "File" || segments.length > 2) {
        entry.resume();
        throw new Error("invalid-zip-path");
      }
      const entryLayout = segments.length === 1 ? "flat" : "wrapper";
      if (layout && layout !== entryLayout) {
        entry.resume();
        throw new Error("invalid-zip-layout");
      }
      if (entryLayout === "wrapper") {
        if (wrapper && wrapper !== segments[0]) {
          entry.resume();
          throw new Error("invalid-zip-layout");
        }
        wrapper = segments[0];
      }
      layout = entryLayout;
      const name = segments.at(-1) as string;
      if (names.has(name)) {
        entry.resume();
        throw new Error("duplicate-image-filename");
      }
      names.add(name);
      const { extension, sortOrder } = validateImageName(name);
      if (sortOrders.has(sortOrder)) {
        entry.resume();
        throw new Error("duplicate-image-sort-order");
      }
      sortOrders.add(sortOrder);
      const tempPath = join(this.tempDir, `${count}.bin`);
      let sizeBytes = 0;
      const first = Buffer.alloc(262144);
      let firstLength = 0;
      const hash = createHash("sha256");
      const limiter = new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          sizeBytes += chunk.length;
          total += chunk.length;
          if (
            sizeBytes > this.limits.maxImageBytes ||
            total > this.limits.maxTotalBytes
          )
            return callback(new Error("zip-size-limit-exceeded"));
          const length = Math.min(chunk.length, first.length - firstLength);
          chunk.copy(first, firstLength, 0, length);
          firstLength += length;
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(entry, limiter, createWriteStream(tempPath));
      const contentType = contentTypeForMagic(
        extension,
        first.subarray(0, firstLength),
      );
      const dimensions = dimensionsForHeader(
        contentType,
        first.subarray(0, firstLength),
      );
      images.push({
        filename: name,
        extension,
        contentType,
        sortOrder,
        sizeBytes,
        checksum: hash.digest("hex"),
        warnings: mediaWarnings({
          filename: name,
          sizeBytes,
          dimensions,
          warnImageBytes: this.limits.warnImageBytes ?? 8388608,
          warnWidthPx: this.limits.warnWidthPx ?? 4000,
          warnHeightPx: this.limits.warnHeightPx ?? 12000,
        }),
        tempPath,
      });
    }
    if (images.length === 0) throw new Error("zip-has-no-images");
    return images.sort((left, right) => left.sortOrder - right.sortOrder);
  }
  readImage(image: ValidatedImage): Readable {
    return createReadStream(image.tempPath);
  }
  async dispose(): Promise<void> {
    if (!this.tempDir) return;
    const files = await readdir(this.tempDir).catch(() => []);
    await Promise.all(
      files.map((file) =>
        rm(join(this.tempDir as string, file), { force: true }),
      ),
    );
    await rm(this.tempDir, { recursive: true, force: true });
    this.tempDir = undefined;
  }
}

function isSafeZipPath(path: string): boolean {
  if (
    path.length === 0 ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[a-zA-Z]:/.test(path)
  )
    return false;
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = normalized.split("/");
  return (
    normalized.length > 0 &&
    segments.every(
      (segment) => segment.length > 0 && segment !== "." && segment !== "..",
    )
  );
}
