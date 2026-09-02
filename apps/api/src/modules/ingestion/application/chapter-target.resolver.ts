import { ChapterNumber } from "../../chapters/domain/chapter-number.js";
import type {
  ChapterConflictReason,
  ChapterTargetResolution,
  ImportChapterCreatePort,
  ImportChapterLookupPort,
  ImportChapterTarget,
} from "./ports.js";

export class ChapterTargetResolver {
  constructor(
    private readonly lookup: ImportChapterLookupPort,
    private readonly chapters: ImportChapterCreatePort,
  ) {}

  async resolve(input: {
    actor: Parameters<ImportChapterCreatePort["create"]>[0]["actor"];
    seriesId: string;
    chapterNumber: number;
    retryChapterId?: string | null;
  }): Promise<ChapterTargetResolution> {
    const chapterNumber = ChapterNumber.parse(input.chapterNumber).toNumber();
    const existing = await this.lookup.findTarget(
      input.seriesId,
      chapterNumber,
    );
    if (existing) return resolveExisting(existing, input.retryChapterId);

    const created = await this.chapters.create({ ...input, chapterNumber });
    if (created.outcome === "created")
      return { kind: "created", chapterId: created.chapterId };
    if (created.outcome === "denied") throw new ChapterTargetDeniedError();
    if (created.outcome === "not-found") throw new ChapterTargetNotFoundError();

    const raced = await this.lookup.findTarget(input.seriesId, chapterNumber);
    if (!raced) throw new ChapterTargetRaceError();
    return resolveExisting(raced, input.retryChapterId);
  }
}

function resolveExisting(
  target: ImportChapterTarget,
  retryChapterId?: string | null,
): ChapterTargetResolution {
  if (
    target.status === "failed" &&
    target.chapterId === retryChapterId &&
    !target.hasActiveUpload &&
    !target.hasMedia
  )
    return { kind: "reused", chapterId: target.chapterId };
  const reason = conflictReason(target);
  return reason
    ? { kind: "conflict", chapterId: target.chapterId, reason }
    : { kind: "reused", chapterId: target.chapterId };
}

function conflictReason(
  target: ImportChapterTarget,
): ChapterConflictReason | null {
  if (target.hasActiveUpload || target.status === "uploading")
    return "chapter-upload-active";
  if (target.status === "processing") return "chapter-processing";
  if (target.status === "ready") return "chapter-ready";
  if (target.status === "failed") return "chapter-failed";
  if (target.status === "deleting") return "chapter-deleting";
  if (target.hasMedia) return "chapter-media-exists";
  if (target.status === "uploaded" || target.hasUpload)
    return "chapter-uploaded";
  return null;
}

export class ChapterTargetDeniedError extends Error {}
export class ChapterTargetNotFoundError extends Error {}
export class ChapterTargetRaceError extends Error {}
