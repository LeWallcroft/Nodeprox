import type { ProcessChapterInput } from "@nodeprox/types";

export type ProcessingOutboxEntry = ProcessChapterInput & {
  id: string;
};

export interface ProcessingOutboxPort {
  findPending(limit: number): Promise<ProcessingOutboxEntry[]>;
  markEnqueued(id: string): Promise<void>;
}
