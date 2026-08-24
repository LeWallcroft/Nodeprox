import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type StagedMultipartFile = {
  stream: Readable;
  sizeBytes: number;
  magicBytes: Uint8Array;
  cleanup: () => Promise<void>;
};

/** Stages a multipart stream once so the storage port receives its exact size. */
export async function stageMultipartFile(
  source: NodeJS.ReadableStream,
): Promise<StagedMultipartFile> {
  const directory = await mkdtemp(join(tmpdir(), "nodeprox-upload-"));
  const path = join(directory, "upload.bin");
  let sizeBytes = 0;
  const magicBytes = Buffer.alloc(4);
  let magicLength = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      const length = Math.min(chunk.length, magicBytes.length - magicLength);
      if (length > 0) {
        chunk.copy(magicBytes, magicLength, 0, length);
        magicLength += length;
      }
      callback(null, chunk);
    },
  });

  try {
    await pipeline(source, counter, createWriteStream(path, { flags: "wx" }));
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }

  let cleaned = false;
  return {
    stream: createReadStream(path),
    sizeBytes,
    magicBytes: magicBytes.subarray(0, magicLength),
    cleanup: async () => {
      if (cleaned) return;
      cleaned = true;
      await rm(directory, { recursive: true, force: true });
    },
  };
}
