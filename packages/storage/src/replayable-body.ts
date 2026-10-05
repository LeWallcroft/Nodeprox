import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { StorageIntegrityError } from "./errors.js";
import type { ReplayableObjectBody } from "./port.js";

export function replayableBuffer(bytes: Buffer): ReplayableObjectBody {
  return { sizeBytes: bytes.length, open: () => Readable.from([bytes]) };
}

export function replayableFile(
  path: string,
  sizeBytes: number,
): ReplayableObjectBody {
  return { sizeBytes, open: () => createReadStream(path) };
}

export async function spoolReplayableBody(
  source: NodeJS.ReadableStream,
  sizeBytes: number,
): Promise<{ body: ReplayableObjectBody; dispose(): Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "nodeprox-object-body-"));
  const path = join(dir, "body.bin");
  let written = 0;
  try {
    await pipeline(
      source,
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length;
          callback(
            written > sizeBytes ? new StorageIntegrityError() : null,
            chunk,
          );
        },
      }),
      createWriteStream(path),
    );
    if (written !== sizeBytes) throw new StorageIntegrityError();
    return {
      body: replayableFile(path, sizeBytes),
      dispose: () => rm(dir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
