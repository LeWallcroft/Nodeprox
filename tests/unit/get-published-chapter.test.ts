import { describe, expect, it } from "vitest";
import { GetPublishedChapter } from "../../apps/api/src/modules/publication/application/services/get-published-chapter.js";
import type { PublishedChapterRepositoryPort } from "../../apps/api/src/modules/publication/application/ports/published-chapter.repository.js";
import type { PublishedChapterRecord } from "../../apps/api/src/modules/publication/domain/publication.types.js";

const chapter = {
  id: "33333333-3333-4333-8333-333333333333",
  seriesId: "22222222-2222-4222-8222-222222222222",
  chapterNumber: 1,
  title: "Chapter One",
  status: "ready" as const,
};

const images = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    chapterId: chapter.id,
    filename: "02.png",
    extension: "png",
    contentType: "image/png",
    sizeBytes: 20,
    sortOrder: 2,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    chapterId: chapter.id,
    filename: "01.jpg",
    extension: "jpg",
    contentType: "image/jpeg",
    sizeBytes: 10,
    sortOrder: 1,
  },
];

function repository(
  chapterValue: PublishedChapterRecord | null = chapter,
  imageValues = images,
): PublishedChapterRepositoryPort {
  return {
    findChapterById: async () => chapterValue,
    listImagesByChapterId: async () => imageValues,
  };
}

describe("GetPublishedChapter", () => {
  it("publishes a ready chapter with sorted canonical image URLs", async () => {
    const result = await new GetPublishedChapter(
      repository(),
      "https://media.nodeprox.org/",
    ).execute(chapter.id);

    expect(result).toEqual({
      id: chapter.id,
      seriesId: chapter.seriesId,
      chapterNumber: 1,
      title: "Chapter One",
      images: [
        {
          id: images[1]?.id,
          filename: images[1]?.filename,
          extension: images[1]?.extension,
          contentType: images[1]?.contentType,
          sizeBytes: images[1]?.sizeBytes,
          sortOrder: images[1]?.sortOrder,
          url: `https://media.nodeprox.org/series/${chapter.seriesId}/chapters/${chapter.id}/images/${images[1]?.id}.jpg`,
        },
        {
          id: images[0]?.id,
          filename: images[0]?.filename,
          extension: images[0]?.extension,
          contentType: images[0]?.contentType,
          sizeBytes: images[0]?.sizeBytes,
          sortOrder: images[0]?.sortOrder,
          url: `https://media.nodeprox.org/series/${chapter.seriesId}/chapters/${chapter.id}/images/${images[0]?.id}.png`,
        },
      ],
    });
    expect(result.images[0]).not.toHaveProperty("storageKey");
    expect(result.images[0]).not.toHaveProperty("checksum");
    expect(result.images[0]).not.toHaveProperty("provider");
  });

  it.each(["draft", "uploading", "uploaded", "processing", "failed"] as const)(
    "rejects a %s chapter as not found",
    async (status) => {
      await expect(
        new GetPublishedChapter(
          repository({ ...chapter, status } as PublishedChapterRecord),
          "https://media.nodeprox.org",
        ).execute(chapter.id),
      ).rejects.toMatchObject({ message: "published-chapter-not-found" });
    },
  );

  it("rejects a missing chapter as not found", async () => {
    await expect(
      new GetPublishedChapter(
        repository(null),
        "https://media.nodeprox.org",
      ).execute(chapter.id),
    ).rejects.toMatchObject({ message: "published-chapter-not-found" });
  });

  it("fails closed when a ready chapter has incomplete image metadata", async () => {
    await expect(
      new GetPublishedChapter(
        repository(chapter, []),
        "https://media.nodeprox.org",
      ).execute(chapter.id),
    ).rejects.toMatchObject({ message: "published-chapter-integrity-error" });
  });
});
